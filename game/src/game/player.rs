use super::geom::{AABB, Position, Velocity};
use super::input::{Input, InputQueue};
use super::{Rules, Tick};
use crate::logging;
use crate::utils::codec::{Decode, Encode};
use crate::utils::frame::{Entity, EntityType};
use crate::utils::types::PlayerKind;

/// A box centered horizontally on a player's position and ending at it (the position is the
/// player's feet). Used for the solidbox and hurtbox of each kind, see KindRules
pub const fn feet_box(w: i32, h: i32) -> AABB {
    AABB {
        pos: Position { x: -w / 2, y: -h },
        w,
        h,
    }
}

/// Like feet_box, but starting `lift` pixels above the feet, for bodies that float
pub const fn floating_box(w: i32, h: i32, lift: i32) -> AABB {
    AABB {
        pos: Position {
            x: -w / 2,
            y: -h - lift,
        },
        w,
        h,
    }
}

pub type PlayerId = u32;

// Inputs sent with each player to new clients. The entity length is a single byte, so they're
// capped to keep it under 255 (34 bytes for the player and its input count, plus 5 per input)
const MAX_STATE_INPUTS: usize = 44;

// 181/256 ≈ 1/√2: scale diagonal movement so speed matches cardinal speed
fn calc_velocity(input: Input, speed: Velocity) -> Velocity {
    // Facing only still turns the player (see apply_input), but it doesn't move horizontally
    let horizontal = if input.face_only { 0 } else { input.horizontal };
    let diagonal = horizontal != 0 && input.vertical != 0;
    let scale = |v| if diagonal { (v * 181 + 128) >> 8 } else { v };
    Velocity {
        x: (horizontal as i32) * scale(speed.x),
        y: (input.vertical as i32) * scale(speed.y),
    }
}

/// Resolves wall collisions by reverting movement along the colliding axis.
/// Tries X first (player slides along Y), then Y, then reverts both.
/// Returns the final hitbox so callers can cache it if needed.
fn resolve_collision_impl(
    aabb: AABB,
    pos: &mut Position,
    vel: &mut Velocity,
    walls: &[AABB],
) -> AABB {
    let hitbox = aabb.at(*pos);
    if !walls.iter().any(|w| hitbox.intersects(w)) {
        return hitbox;
    }
    let vx = vel.x;
    let vy = vel.y;
    if vx != 0 {
        let p = Position {
            x: pos.x - vx,
            y: pos.y,
        };
        let h = aabb.at(p);
        if !walls.iter().any(|w| h.intersects(w)) {
            *pos = p;
            vel.x = 0;
            return h;
        }
    }
    if vy != 0 {
        let p = Position {
            x: pos.x,
            y: pos.y - vy,
        };
        let h = aabb.at(p);
        if !walls.iter().any(|w| h.intersects(w)) {
            *pos = p;
            vel.y = 0;
            return h;
        }
    }
    pos.x -= vx;
    pos.y -= vy;
    *vel = Velocity::null();
    aabb.at(*pos)
}

#[allow(dead_code)]
pub struct Player {
    id: PlayerId,
    kind: PlayerKind,
    solidbox: AABB,
    hurtbox: AABB,
    input_queue: InputQueue,
    score: u32,
    position: Position,
    velocity: Velocity,
    pub min_next_shot_tick: Tick,
    hp: u8,
    alive: bool,
    spawn_timer: i32, // The spawn timer is negative when it's not even started
    orientation: i8,
    sprite: u8,
    // Only used by the clients to have an estimation of the server truth
    server_input: InputQueue,
    server_position: Position,
    server_velocity: Velocity,
    server_tick: Tick,
    // Server state extrapolated to the current client tick; blended into position for rendering
    predicted_position: Position,
}

#[allow(dead_code)]
impl Player {
    pub fn new(id: PlayerId, kind: PlayerKind, sprite: u8) -> Self {
        Self {
            id,
            kind,
            // Placed when the player spawns
            solidbox: feet_box(0, 0),
            hurtbox: feet_box(0, 0),
            input_queue: InputQueue::new(),
            score: 0,
            position: Position::at_origin(),
            velocity: Velocity::null(),
            min_next_shot_tick: 0,
            hp: 0,
            alive: false,
            // Start with a negative spawn timer so the player doesn't spawn automatically
            spawn_timer: -1,
            orientation: 1,
            sprite,
            server_input: InputQueue::new(),
            server_position: Position::at_origin(),
            server_velocity: Velocity::null(),
            server_tick: 0,
            predicted_position: Position::at_origin(),
        }
    }

    /// Reads a player from the state sent to new clients (see to_state_entity)
    pub fn from_state_entity(e: Entity) -> Self {
        let mut offset = 0;
        let mut player = Self::decode(&e.data, &mut offset);
        let num_inputs = u8::decode(&e.data, &mut offset);
        for _ in 0..num_inputs {
            let tick = Tick::decode(&e.data, &mut offset);
            let packed = u8::decode(&e.data, &mut offset);
            // Also added to the copy of the server's simulation, used for the prediction
            player.add_input(Input::new(tick, packed), true);
        }
        player
    }

    pub fn id(&self) -> PlayerId {
        self.id
    }

    pub fn kind(&self) -> PlayerKind {
        self.kind
    }

    pub fn position(&self) -> Position {
        self.position
    }

    pub fn orientation(&self) -> i8 {
        self.orientation
    }

    pub fn sprite(&self) -> u8 {
        self.sprite
    }

    pub fn alive(&self) -> bool {
        self.alive
    }

    pub fn hp(&self) -> u8 {
        self.hp
    }

    pub fn score(&self) -> u32 {
        self.score
    }

    // Only the server changes the score, the clients get it through ScoreUpdate events
    pub fn set_score(&mut self, score: u32) {
        self.score = score;
    }

    pub fn solidbox(&self) -> AABB {
        self.solidbox
    }

    pub fn hurtbox(&self) -> AABB {
        self.hurtbox
    }

    pub fn spawn_timer(&self) -> i32 {
        self.spawn_timer
    }

    pub fn on_hit(&mut self, damage: u8) {
        self.set_hp(self.hp.saturating_sub(damage));
    }

    /// Sets the HP, the player dies when it reaches 0. Used directly by the clients, which take
    /// the HP from the server instead of applying the damage, so they can't disagree on who's alive
    pub fn set_hp(&mut self, hp: u8) {
        self.hp = hp;
        if hp == 0 && self.alive {
            self.alive = false;
            // The server ignores the inputs of dead players, so the last one would otherwise still
            // be applied after respawning (and the clients' copy of the server would move them
            // while they're spawning, since it doesn't check if they're alive)
            self.input_queue = InputQueue::new();
            self.server_input = InputQueue::new();
        }
    }

    pub fn spawn_at(&mut self, pos: Position, in_ticks: u8) {
        self.position = pos;
        self.server_position = pos;
        self.predicted_position = pos;
        self.spawn_timer = in_ticks as i32;
    }

    pub fn last_known_input_tick(&self) -> Tick {
        self.input_queue.last_known_tick()
    }

    pub fn server_tick(&self) -> Tick {
        self.server_tick
    }

    pub fn set_server_tick(&mut self, tick: Tick) {
        self.server_tick = tick;
    }

    /// Extrapolates server state from server_tick to target_tick using server_input,
    /// storing the result in predicted_position without touching server_position or server_tick.
    pub fn predict_forward(&mut self, target_tick: Tick, rules: &Rules, walls: &[AABB]) {
        let mut pos = self.server_position;
        let mut tick = self.server_tick;
        while tick < target_tick {
            tick += 1;
            let input = self.server_input.peek_at(tick);
            let mut vel = calc_velocity(input, rules.kind(self.kind).speed);
            if vel.x != 0 || vel.y != 0 {
                pos.x += vel.x;
                pos.y += vel.y;
                resolve_collision_impl(rules.kind(self.kind).solidbox, &mut pos, &mut vel, walls);
            }
        }
        self.predicted_position = pos;
    }

    /// Nudges position halfway toward the server-extrapolated prediction so they converge.
    pub fn apply_prediction_blend(&mut self) {
        self.position.x += (self.predicted_position.x - self.position.x) / 2;
        self.position.y += (self.predicted_position.y - self.position.y) / 2;
    }

    /// Advances the server-side simulation from `server_tick` up to `last_server_tick`,
    /// using `server_input` and writing into `server_position`/`server_velocity`.
    pub fn step_until_server_tick(
        &mut self,
        last_server_tick: Tick,
        rules: &Rules,
        walls: &[AABB],
    ) {
        while self.server_tick < last_server_tick {
            self.server_tick += 1;
            self.step_server(self.server_tick, rules, walls);
        }
    }

    fn step_server(&mut self, tick: Tick, rules: &Rules, walls: &[AABB]) {
        let input = *self.server_input.get_current_input(tick);
        self.server_velocity = calc_velocity(input, rules.kind(self.kind).speed);
        if self.server_velocity.x != 0 || self.server_velocity.y != 0 {
            self.server_position.x += self.server_velocity.x;
            self.server_position.y += self.server_velocity.y;
            resolve_collision_impl(
                rules.kind(self.kind).solidbox,
                &mut self.server_position,
                &mut self.server_velocity,
                walls,
            );
        }
    }

    /// Adds an input to the player's input queue, if the input comes from the server,
    /// it's also added to the server_input queue for client-side prediction
    pub fn add_input(&mut self, input: Input, from_server: bool) {
        self.input_queue.push(input);
        if from_server {
            self.server_input.push(input);
        }
    }

    /// Applies input for the given tick and resolves collisions.
    pub fn server_step(&mut self, tick: Tick, rules: &Rules, walls: &[AABB]) {
        self.step(tick, rules, walls)
    }

    pub fn client_step(&mut self, tick: Tick, rules: &Rules, walls: &[AABB]) {
        self.step(tick, rules, walls)
    }

    fn step(&mut self, tick: Tick, rules: &Rules, walls: &[AABB]) {
        if self.alive {
            self.apply_input(tick, rules);
            self.resolve_collision(rules, walls);
        } else {
            if self.spawn_timer > 0 {
                self.spawn_timer -= 1;
            } else if self.spawn_timer == 0 {
                self.hp = rules.kind(self.kind).max_hp;
                self.alive = true;
                // Otherwise they'd stay wherever the player was until its next step
                self.update_boxes(rules);
                logging::debug(&format!(
                    "{} {} spawned at ({}, {})",
                    self.kind.name(),
                    self.id,
                    self.position.x,
                    self.position.y
                ));
                // Reset the spawn timer
                self.spawn_timer = -1;
            }
        }
    }

    fn apply_input(&mut self, tick: Tick, rules: &Rules) {
        let input = *self.input_queue.get_current_input(tick);
        if input.horizontal != 0 {
            self.orientation = input.horizontal;
        }
        self.velocity = calc_velocity(input, rules.kind(self.kind).speed);
        if self.velocity.x != 0 || self.velocity.y != 0 {
            self.position.x += self.velocity.x;
            self.position.y += self.velocity.y;
            self.update_boxes(rules);
        }
    }

    pub fn to_entity(&self) -> Entity {
        let mut data = Vec::with_capacity(33);
        self.encode(&mut data);
        Entity {
            entity_type: EntityType::Player,
            data,
        }
    }

    /// Like to_entity, plus the inputs, for the state sent to new clients. Without them, a player
    /// holding a direction stands still on the new client until its next input, and stays offset
    /// from where it is for everyone else. The renderer doesn't need them, so they're not part of
    /// to_entity
    pub fn to_state_entity(&self) -> Entity {
        let inputs: Vec<&Input> = self.input_queue.all().take(MAX_STATE_INPUTS).collect();
        let mut data = Vec::with_capacity(34 + inputs.len() * 5);
        self.encode(&mut data);
        (inputs.len() as u8).encode(&mut data);
        for input in inputs {
            input.tick.encode(&mut data);
            input.packed().encode(&mut data);
        }
        Entity {
            entity_type: EntityType::Player,
            data,
        }
    }

    fn resolve_collision(&mut self, rules: &Rules, walls: &[AABB]) {
        let kind_rules = rules.kind(self.kind);
        self.solidbox = resolve_collision_impl(
            kind_rules.solidbox,
            &mut self.position,
            &mut self.velocity,
            walls,
        );
        self.hurtbox = kind_rules.hurtbox.at(self.position);
    }

    /// Moves the solidbox and hurtbox to the player's position
    fn update_boxes(&mut self, rules: &Rules) {
        let kind_rules = rules.kind(self.kind);
        self.solidbox = kind_rules.solidbox.at(self.position);
        self.hurtbox = kind_rules.hurtbox.at(self.position);
    }
}

// Player wire format (entity_type = 0):
//
// meta:
//   endian: be
//
// seq:
//   - id: id
//     type: u4
//   - id: position_x
//     type: s4
//   - id: position_y
//     type: s4
//   - id: velocity_x
//     type: s4
//   - id: velocity_y
//     type: s4
//   - id: score
//     type: u4
//   - id: alive
//     type: u1
//   - id: hp
//     type: u1
//   - id: orientation
//     type: s1
//   - id: sprite
//     type: u1
//   - id: spawn_timer
//     type: s4
//   - id: kind
//     type: u1
//     doc: 0 for PCs, 1 for npc1, 2 for npc2
//
// In the state sent to new clients (to_state_entity) it's followed by the inputs:
//
//   - id: num_inputs
//     type: u1
//   - id: inputs
//     repeat: expr
//     repeat-expr: num_inputs
//     doc: The input being applied, then the ones queued for later ticks
//     seq:
//       - id: tick
//         type: u4
//       - id: packed
//         type: u1

impl Encode for Player {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.id.encode(buf);
        self.position.x.encode(buf);
        self.position.y.encode(buf);
        self.velocity.x.encode(buf);
        self.velocity.y.encode(buf);
        self.score.encode(buf);
        self.alive.encode(buf);
        self.hp.encode(buf);
        self.orientation.encode(buf);
        self.sprite.encode(buf);
        // Players that join while someone is spawning missed the spawn event, so they need the
        // timer to spawn them
        self.spawn_timer.encode(buf);
        self.kind.encode(buf);
    }
}

impl Decode for Player {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let id = u32::decode(data, offset);
        let position = Position {
            x: i32::decode(data, offset),
            y: i32::decode(data, offset),
        };
        let velocity = Velocity {
            x: i32::decode(data, offset),
            y: i32::decode(data, offset),
        };
        let score = u32::decode(data, offset);
        let alive = bool::decode(data, offset);
        let hp = u8::decode(data, offset);
        let orientation = i8::decode(data, offset);
        let sprite = u8::decode(data, offset);
        let spawn_timer = i32::decode(data, offset);
        let kind = PlayerKind::decode(data, offset);

        let mut player = Self::new(id, kind, sprite);
        player.position = position;
        player.server_position = position;
        player.predicted_position = position;
        player.velocity = velocity;
        player.server_velocity = velocity;
        player.score = score;
        player.alive = alive;
        player.hp = hp;
        player.orientation = orientation;
        player.spawn_timer = spawn_timer;
        player
    }
}
