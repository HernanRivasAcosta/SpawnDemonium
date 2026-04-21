mod ai;
mod geom;
mod input;
mod map;
mod player;
mod shot;
use crate::logging;
use crate::utils::codec::{Decode, Encode};
use crate::utils::events::{
    EventType, InputEvent, PlayerJoin, PlayerLeft, PlayerShot, PlayerSpawn, ScoreUpdate, ShotHit,
    ShotHitPlayer,
};
use crate::utils::frame::{Entity, EntityType, MAX_FRAME_ENTITIES, Output};
use crate::utils::types::PlayerKind;
use ai::{NpcAi, WanderRules};
use geom::{AABB, Position, Velocity};
use input::{FACE_ONLY, FIRE, Input};
use map::Map;
use player::Player;
use player::PlayerId;
use player::{feet_box, floating_box};
use shot::{Shot, ShotKind};
use std::cmp::Reverse;
use std::collections::HashMap;

pub type Tick = u32;

// Knuth MMIX LCG (https://en.wikipedia.org/wiki/Linear_congruential_generator#Haskell_code). Takes
// the state instead of the GameState so it can be used while other fields are borrowed
fn next_random(state: &mut u64) -> u64 {
    *state = state
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *state
}

#[derive(Default)]
struct ParsedEntities {
    players: HashMap<PlayerId, Player>,
    shots: HashMap<u32, Shot>,
}

fn parse_entities(data: &[u8]) -> ParsedEntities {
    let mut out = ParsedEntities::default();
    let num_entities = data[0] as usize;
    let mut offset = 1;
    for _ in 0..num_entities {
        let entity_len = data[offset] as usize;
        let entity_type = data[offset + 1];
        let entity_data = data[offset + 2..offset + 1 + entity_len].to_vec();
        offset += 1 + entity_len;
        match entity_type {
            t if t == EntityType::Player as u8 => {
                let player = Player::from_state_entity(Entity {
                    entity_type: EntityType::Player,
                    data: entity_data,
                });
                out.players.insert(player.id(), player);
            }
            t if t == EntityType::Shot as u8 => {
                let shot = Shot::from_entity(Entity {
                    entity_type: EntityType::Shot,
                    data: entity_data,
                });
                out.shots.insert(shot.id(), shot);
            }
            _ => {}
        }
    }
    out
}

// An NPC can't spawn within these distances of a player
const MIN_DISTANCE_X: i32 = 500;
const MIN_DISTANCE_Y: i32 = 400;
// Spawn points tried per tick, if they all fail the spawn is tried again on the next tick
const NPC_SPAWN_ATTEMPTS: u32 = 8;
// There's an npc2 for every this many npc1
const NPC1_PER_NPC2: usize = 3;
// NPC ids start here, so they never collide with the PC ids the server assigns
const FIRST_NPC_ID: PlayerId = 1 << 31;
// The client draws NPCs by kind, the sprite only picks the colour of PCs
const NPC_SPRITE: u8 = 0;

/// Ticks until the next NPC spawns, shorter when there are fewer NPCs
fn next_spawn_time(npc_count: usize) -> Tick {
    40 + 20 * npc_count as Tick
}

/// The rules that depend on the kind of player
pub struct KindRules {
    pub speed: Velocity,
    pub max_hp: u8,
    // Wall collisions
    pub solidbox: AABB,
    // Bullet collisions
    pub hurtbox: AABB,
    // Score granted when killed
    pub points: u32,
    // The type of bullet it fires
    pub shot: ShotKind,
    // Ticks between shots
    pub shoot_cooldown: Tick,
    // Only used by NPCs
    pub wander: WanderRules,
}

#[allow(dead_code)]
pub struct Rules {
    pub pc: KindRules,
    pub npc1: KindRules,
    pub npc2: KindRules,
    pub bullet_damage: u8,
    pub player_spawn_timer: u8,
    pub shot_speed: i32,
    pub max_npcs: usize,
    // NPCs a new game starts with
    pub initial_npcs: usize,
}

impl Rules {
    pub fn kind(&self, kind: PlayerKind) -> &KindRules {
        match kind {
            PlayerKind::Pc => &self.pc,
            PlayerKind::Npc1 => &self.npc1,
            PlayerKind::Npc2 => &self.npc2,
        }
    }
}

#[allow(dead_code)]
pub struct GameState {
    server: bool,
    tick: Tick,
    map: Map,
    players: HashMap<PlayerId, Player>,
    shots: HashMap<u32, Shot>,
    rules: Rules,
    rng: u64,
    available_sprites: Vec<u8>,
    next_id: u32,
    // Only used by the server
    next_npc_id: PlayerId,
    next_npc_spawn_tick: Tick,
    npc_ais: HashMap<PlayerId, NpcAi>,
}

#[allow(dead_code)]
impl GameState {
    pub fn new(server: bool, init_data_ptr: *const u8) -> Self {
        // First 4 bytes are the map size (big-endian u32), followed by the map data
        let map_size = unsafe { u32::from_be_bytes(*(init_data_ptr as *const [u8; 4])) as usize };
        let map = Map::from(unsafe { init_data_ptr.add(4) }, map_size);
        // The next 2 bytes are the size of the entity data (big-endian u16),
        // The entities are empty when initialising a server
        let entity_data_size = unsafe {
            u16::from_be_bytes(*(init_data_ptr.add(4 + map_size) as *const [u8; 2])) as usize
        };
        let entity_data_ptr = unsafe { init_data_ptr.add(4 + map_size + 2) };
        let ParsedEntities { mut players, shots } = if entity_data_size > 0 {
            let data = unsafe { std::slice::from_raw_parts(entity_data_ptr, entity_data_size) };
            parse_entities(data)
        } else {
            ParsedEntities::default()
        };
        logging::debug(&format!("loaded {entity_data_size} bytes of entities:"));
        let num_players = players.len();
        logging::debug(&format!("  - {num_players} players"));
        // The first id needs to be higher than all the existing ones
        let next_id = shots.keys().copied().max().unwrap_or(0) + 1;
        // The next 2 bytes are the metadata size, followed by the metadata.
        // The first 4 bytes of metadata are always the current tick (big-endian u32).
        let metadata_ptr = unsafe { init_data_ptr.add(4 + map_size + 2 + entity_data_size + 2) };
        let tick = unsafe { u32::from_be_bytes(*(metadata_ptr as *const [u8; 4])) };
        let rng = unsafe { u64::from_be_bytes(*(metadata_ptr.add(4) as *const [u8; 8])) };
        for player in players.values_mut() {
            player.set_server_tick(tick);
        }
        // Create the game state
        let mut state = Self {
            server,
            tick,
            map,
            players,
            shots,
            rng,
            available_sprites: (1..7).collect(),
            next_id,
            next_npc_id: FIRST_NPC_ID,
            next_npc_spawn_tick: tick + next_spawn_time(0),
            npc_ais: HashMap::new(),
            // Since the rules are hardcoded we don't import/export them, but maybe we will in the future
            rules: Rules {
                // The sprites are drawn at twice their size. The PC's solidbox is ~85% of its
                // widest frame, but the NPCs' cover all of it so they don't go into the walls.
                // The hurtboxes are ~70% of the width and ~75% of the height
                pc: KindRules {
                    speed: Velocity { x: 4, y: 3 },
                    max_hp: 6,
                    solidbox: feet_box(24, 2),
                    hurtbox: feet_box(18, 22),
                    points: 500,
                    shot: ShotKind {
                        height: 10,
                        sprite: 2,
                    },
                    shoot_cooldown: 15,
                    // PCs don't wander
                    wander: WanderRules {
                        min_ticks: 0,
                        max_ticks: 0,
                    },
                },
                // The speeds are placeholders until the NPCs can be play-tested
                npc1: KindRules {
                    speed: Velocity { x: 3, y: 2 },
                    max_hp: 3,
                    solidbox: feet_box(26, 2),
                    // The robot floats, its body is ~22-52px above its feet. The box starts lower
                    // so shots (flying at the PCs' shot height) from the same row still hit it
                    hurtbox: floating_box(20, 40, 8),
                    points: 100,
                    shot: ShotKind {
                        height: 22,
                        sprite: 3,
                    },
                    shoot_cooldown: 4,
                    // 1 to 3 seconds
                    wander: WanderRules {
                        min_ticks: 60,
                        max_ticks: 160,
                    },
                },
                npc2: KindRules {
                    // About half of npc1 speed
                    speed: Velocity { x: 2, y: 1 },
                    max_hp: 6,
                    solidbox: feet_box(52, 2),
                    hurtbox: feet_box(38, 46),
                    points: 250,
                    shot: ShotKind {
                        height: 22,
                        sprite: 3,
                    },
                    shoot_cooldown: 4,
                    // 1.5 to 4 seconds, it's slower
                    wander: WanderRules {
                        min_ticks: 80,
                        max_ticks: 190,
                    },
                },
                bullet_damage: 1,
                player_spawn_timer: 35,
                shot_speed: 8,
                max_npcs: 20,
                initial_npcs: 10,
            },
        };
        if server {
            state.populate_npcs();
        }
        state
    }

    pub fn get_tick(&self) -> Tick {
        self.tick
    }

    fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn next_rng(&mut self) -> u64 {
        next_random(&mut self.rng)
    }

    pub fn add_player(&mut self, id: PlayerId) -> Result<(), String> {
        if !self.server {
            return Err("add_player: only available on servers".to_string());
        }
        if self.players.contains_key(&id) {
            return Err(format!("add_player: player {id} already exists").to_string());
        }
        if id == 0 {
            return Err("add_player: player id cannot be 0".to_string());
        }
        let sprite = if !self.available_sprites.is_empty() {
            let idx = (self.next_rng() as usize) % self.available_sprites.len();
            self.available_sprites.swap_remove(idx)
        } else {
            // The sprites go from 1 to 6
            (self.next_rng() % 6) as u8 + 1
        };
        let player = Player::new(id, PlayerKind::Pc, sprite);
        self.players.insert(id, player);

        let mut out = Output::new();
        // The event is sent to all pre existing players
        out.events
            .push(PlayerJoin::new(id, sprite, PlayerKind::Pc).into_event());
        // The state (entities + metadata) is sent only to the new player
        self.push_state(&mut out);
        out.flush();
        Ok(())
    }

    /// Outputs the state a new client needs to start (entities + metadata) without changing it
    pub fn get_state(&self) -> Result<(), String> {
        if !self.server {
            return Err("get_state: only available on servers".to_string());
        }
        let mut out = Output::new();
        self.push_state(&mut out);
        out.flush();
        Ok(())
    }

    fn push_state(&self, out: &mut Output) {
        for player in self.players.values() {
            out.entities.push(player.to_state_entity());
        }
        // Including the shots that haven't left the gun yet, the new client simulates them too
        self.push_shots(out, Tick::MAX);
        self.tick.encode(&mut out.metadata);
    }

    pub fn remove_player(&mut self, id: PlayerId) -> Result<(), String> {
        if !self.server {
            return Err("remove_player: only available on servers".to_string());
        }
        let removed = match self.players.remove(&id) {
            None => return Err(format!("remove_player: player {id} does not exist").to_string()),
            Some(p) => p,
        };
        self.available_sprites.push(removed.sprite());
        let mut out = Output::new();
        out.events.push(PlayerLeft::new(id).into_event());
        out.flush();
        Ok(())
    }

    /// When an input is received on the server, if the tick happened in the past,
    /// it gets applied to the current tick instead
    pub fn player_input(
        &mut self,
        player_id: PlayerId,
        tick: Tick,
        raw_input: u8,
    ) -> Result<(), String> {
        if self.server {
            let mut out = Output::new();
            // Facing without moving is only for NPCs, PCs could use it to aim while dodging
            let raw_input = raw_input & !FACE_ONLY;
            let result = self.queue_input(player_id, tick, raw_input, &mut out);
            // Flushed even when the input is ignored, otherwise the server would read the events
            // of the previous call again
            out.flush();
            result
        } else {
            unimplemented!();
        }
    }

    /// Queues an input on the server and outputs its events
    fn queue_input(
        &mut self,
        player_id: PlayerId,
        mut tick: Tick,
        raw_input: u8,
        out: &mut Output,
    ) -> Result<(), String> {
        match self.players.get_mut(&player_id) {
            None => Err(format!("player_input: player {player_id} does not exist").to_string()),
            Some(player) => {
                let spawning = player.spawn_timer() >= 0;
                if !player.alive() && !spawning {
                    // Simply ignore the input. It's not a guarantee of cheating.
                    return Ok(());
                }
                // Spawning players can't fire yet, shooting is also how PCs ask to spawn
                let raw_input = if spawning {
                    raw_input & !FIRE
                } else {
                    raw_input
                };
                // Clamp late inputs to the current tick, the last known input tick (so inputs
                // don't get applied out of order) or the first tick after the player spawns,
                // whichever comes last. The spawn timer is -1 when not spawning
                tick = tick
                    .max(self.tick)
                    .max(player.last_known_input_tick() + 1)
                    .max(self.tick + (player.spawn_timer() + 1) as u32);
                let input = Input::new(tick, raw_input);
                let fire = input.fire;
                // Use the input's horizontal direction as shot orientation if pressed,
                // otherwise fall back to the player's current orientation.
                let shot_orientation = if input.horizontal != 0 {
                    input.horizontal
                } else {
                    // TODO: If the input queue has pending inputs, the player's current orientation
                    // may not reflect the orientation at shot_tick yet — but this only affects
                    // players moving erratically with high ping, so it's good enough for now.
                    player.orientation()
                };
                let kind_rules = self.rules.kind(player.kind());
                let shot_kind = kind_rules.shot;
                let shot_pos = player
                    .position()
                    .translated((shot_orientation * 12).into(), -(shot_kind.height as i32));
                let should_shoot = fire && tick >= player.min_next_shot_tick;
                let shooter_id = player.id();
                if should_shoot {
                    player.min_next_shot_tick = self.tick + kind_rules.shoot_cooldown;
                }
                player.add_input(input, false);
                // `player` borrow ends here; alloc_id can now borrow self
                out.events
                    .push(InputEvent::new(player_id, tick, raw_input).into_event());
                if should_shoot {
                    let id = self.alloc_id();
                    self.shots.insert(
                        id,
                        Shot::new(
                            shooter_id,
                            id,
                            shot_pos,
                            shot_orientation,
                            tick,
                            shot_kind,
                            &self.rules,
                        ),
                    );
                    out.events.push(
                        PlayerShot::new(
                            tick,
                            id,
                            player_id,
                            shot_pos,
                            shot_orientation,
                            shot_kind.height,
                            shot_kind.sprite,
                        )
                        .into_event(),
                    );
                }
                Ok(())
            }
        }
    }

    pub fn spawn_player(&mut self, player_id: PlayerId, mut tick: Tick) -> Result<(), String> {
        if !self.server {
            return Err("spawn_player: only available on servers".to_string());
        }
        let rng = self.next_rng();
        let pos = self.map.random_player_spawn(rng);

        if tick > self.tick + 255 {
            return Err(format!("spawn_player: tick {tick} is too far in the future").to_string());
        }

        tick = tick.max(self.tick + self.rules.player_spawn_timer as u32 + 1);
        match self.players.get_mut(&player_id) {
            None => Err(format!("spawn_player: player {player_id} does not exist").to_string()),
            Some(player) => {
                player.spawn_at(pos, (tick - self.tick) as u8);
                // Output the event
                let mut out = Output::new();
                out.events
                    .push(PlayerSpawn::new(player_id, pos, tick, player.sprite()).into_event());
                out.flush();

                Ok(())
            }
        }
    }

    fn handle_server_events(&mut self, events_ptr: *const u8, out: &mut Output) {
        // The events are preceded by 2 bytes for the size, we can ignore them
        let mut offset: usize = 2;
        // The following byte is the number of events, followed by the events themselves
        let num_events = unsafe { *events_ptr.add(offset) } as usize;
        offset += 1;
        for _ in 0..num_events {
            let event_len = unsafe { *events_ptr.add(offset) } as usize;
            offset += 1;
            let event_type = unsafe { *events_ptr.add(offset) };
            offset += 1;
            let data = unsafe { std::slice::from_raw_parts(events_ptr.add(offset), event_len - 1) };
            offset += event_len - 1;
            let mut cursor = 0;
            match event_type {
                t if t == EventType::PlayerJoin as u8 => {
                    let event = PlayerJoin::decode(data, &mut cursor);
                    let player = Player::new(event.player_id, event.kind, event.sprite);
                    self.players.insert(event.player_id, player);
                }
                t if t == EventType::PlayerLeft as u8 => {
                    let event = PlayerLeft::decode(data, &mut cursor);
                    self.players.remove(&event.player_id);
                    logging::debug(&format!("player {} left", event.player_id));
                    out.events.push(event.into_event());
                }
                t if t == EventType::PlayerSpawn as u8 => {
                    let event = PlayerSpawn::decode(data, &mut cursor);
                    let timer = (event.tick as i64 - self.tick as i64).max(0) as u8;
                    let player = self
                        .players
                        .get_mut(&event.player_id)
                        .expect("tick: PlayerSpawn event for non existing player");
                    player.spawn_at(event.position, timer);
                    out.events.push(event.into_event());
                }
                t if t == EventType::Input as u8 => {
                    let mut event = InputEvent::decode(data, &mut cursor);
                    let player = self
                        .players
                        .get_mut(&event.player_id)
                        .expect("tick: PlayerSpawn event for non existing player");
                    player.add_input(Input::new(event.tick, event.raw_input), true);
                    while event.tick < self.tick {
                        // This fast forwarding doesn't advance the last known server tick
                        player.client_step(self.tick, &self.rules, &self.map.all_aabbs);
                        event.tick += 1
                    }
                }
                t if t == EventType::PlayerShot as u8 => {
                    // TODO: shot creation + catch-up is duplicated from player_input — extract helper
                    let event = PlayerShot::decode(data, &mut cursor);
                    let wall_aabbs = self.map.wall_aabbs.as_slice();
                    let mut shot = Shot::new(
                        // The shooter id doesn't matter client side
                        0,
                        event.id,
                        event.position,
                        event.orientation,
                        event.tick,
                        ShotKind {
                            height: event.height,
                            sprite: event.sprite,
                        },
                        &self.rules,
                    );
                    let mut step_tick = event.tick;
                    let mut hit_wall = false;
                    while step_tick < self.tick {
                        if shot.step(step_tick, wall_aabbs) {
                            hit_wall = true;
                            break;
                        }
                        step_tick += 1;
                    }
                    let shot_id = event.id;
                    // Forward the event to the renderer so it can play the shot effects, before
                    // any wall hit so both arrive in order
                    out.events.push(event.into_event());
                    if hit_wall {
                        out.events
                            .push(ShotHit::new(step_tick, shot_id, shot.position()).into_event());
                    } else {
                        self.shots.insert(shot_id, shot);
                    }
                }
                t if t == EventType::ShotHitPlayer as u8 => {
                    let event = ShotHitPlayer::decode(data, &mut cursor);
                    // The server removed the shot when it hit, so it has to stop flying here too
                    self.shots.remove(&event.shot_id);
                    if let Some(player) = self.players.get_mut(&event.player_id) {
                        player.set_hp(event.hp);
                        // NPCs don't respawn, so they're removed as soon as they die, like on the
                        // server
                        if !event.alive && player.kind() != PlayerKind::Pc {
                            self.players.remove(&event.player_id);
                        }
                    }
                    // Forward the event to the renderer so it can show hit effects
                    out.events.push(event.into_event());
                }
                t if t == EventType::ScoreUpdate as u8 => {
                    // The score is only kept by the server, the renderer shows it
                    out.events
                        .push(ScoreUpdate::decode(data, &mut cursor).into_event());
                }
                _ => {
                    logging::warn(&format!("tick: unknown event type {event_type}: {data:?}"));
                }
            }
        }
    }

    pub fn server_tick(&mut self) -> Tick {
        let mut out = Output::new();
        self.tick += 1;
        // The NPCs decide before the players move, their inputs are queued ai::INPUT_DELAY ticks
        // ahead so the clients get them in time
        self.update_npcs(&mut out);
        // Update player positions
        let tick = self.tick;
        let rules = &self.rules;
        let all_aabbs = self.map.all_aabbs.as_slice();
        for player in self.players.values_mut() {
            player.server_step(tick, rules, all_aabbs);
        }
        // Update shots
        self.step_shots();
        // Check if any shot hit a player
        self.check_shot_collisions(&mut out);
        self.spawn_npcs(&mut out);
        // Push any events
        out.flush();
        self.tick
    }

    pub fn client_tick(&mut self, last_server_tick: Tick, events_ptr: *const u8) -> Tick {
        let mut out = Output::new();
        self.handle_server_events(events_ptr, &mut out);
        {
            let rules = &self.rules;
            let all_aabbs = self.map.all_aabbs.as_slice();
            for player in self.players.values_mut() {
                player.step_until_server_tick(last_server_tick, rules, all_aabbs);
            }
        }
        self.tick += 1;
        let tick = self.tick;
        {
            let rules = &self.rules;
            let all_aabbs = self.map.all_aabbs.as_slice();
            for player in self.players.values_mut() {
                player.client_step(tick, rules, all_aabbs);
            }
        }
        // Extrapolate server state to current tick without clobbering the authoritative
        // server_position, then blend with local prediction for rendering
        {
            let rules = &self.rules;
            let all_aabbs = self.map.all_aabbs.as_slice();
            for player in self.players.values_mut() {
                player.predict_forward(tick, rules, all_aabbs);
                player.apply_prediction_blend();
            }
        }
        for (id, pos) in self.step_shots() {
            out.events
                .push(ShotHit::new(self.tick, id, pos).into_event());
        }
        for player in self.players.values() {
            // Spawning players are included so the renderer can play their spawn animation
            if player.alive() || player.spawn_timer() >= 0 {
                out.entities.push(player.to_entity());
            }
        }
        self.push_shots(&mut out, self.tick);
        out.flush();
        self.tick
    }

    fn step_shots(&mut self) -> Vec<(u32, Position)> {
        let tick = self.tick;
        let wall_aabbs = self.map.wall_aabbs.as_slice();
        let dead: Vec<(u32, Position)> = self
            .shots
            .values_mut()
            .filter_map(|shot| {
                shot.step(tick, wall_aabbs)
                    .then(|| (shot.id(), shot.position()))
            })
            .collect();
        for (id, _) in &dead {
            self.shots.remove(id);
        }
        dead
    }

    /// Spawns an NPC when it's time and there's room for one. Only happens in the server, the
    /// clients get the NPC through the PlayerJoin and PlayerSpawn events
    fn spawn_npcs(&mut self, out: &mut Output) {
        if self.tick < self.next_npc_spawn_tick {
            return;
        }
        let npc_count = self
            .players
            .values()
            .filter(|p| p.kind() != PlayerKind::Pc)
            .count();
        // Once there's room again, the NPC spawns right away
        if npc_count >= self.rules.max_npcs {
            return;
        }
        // If there's no good spawn point, it tries again on the next tick
        let kind = self.next_npc_kind();
        let Some(pos) = self.find_npc_spawn_point(kind) else {
            return;
        };
        let id = self.add_npc(pos, kind);
        out.events
            .push(PlayerJoin::new(id, NPC_SPRITE, kind).into_event());
        out.events
            .push(PlayerSpawn::new(id, pos, self.tick, NPC_SPRITE).into_event());
        self.next_npc_spawn_tick = self.tick + next_spawn_time(npc_count + 1);
    }

    /// Runs the AI of the NPCs that are alive, queueing an input when one changes direction
    fn update_npcs(&mut self, out: &mut Output) {
        let pcs: Vec<(PlayerId, Position)> = self
            .players
            .values()
            .filter(|p| p.kind() == PlayerKind::Pc && p.alive())
            .map(|p| (p.id(), p.position()))
            .collect();
        // The NPCs aim at the middle of the PCs' hurtbox
        let hurtbox = self.rules.pc.hurtbox;
        let aim_offset = hurtbox.pos.y + hurtbox.h / 2;
        let mut turning = Vec::new();
        for (id, ai) in self.npc_ais.iter_mut() {
            let Some(npc) = self.players.get(id).filter(|p| p.alive()) else {
                continue;
            };
            let previous = ai.target();
            if ai.look(npc.position(), &pcs) {
                let name = npc.kind().name();
                if let Some(lost) = previous {
                    logging::debug(&format!("{name} {id} lost {lost}"));
                }
                if let Some(target) = ai.target() {
                    logging::debug(&format!("{name} {id} spotted {target}"));
                }
            }
            let rules = self.rules.kind(npc.kind());
            if let Some(input) = ai.update(npc.position(), rules, &pcs, aim_offset, &mut self.rng) {
                turning.push((*id, input));
            }
        }
        for (id, input) in turning {
            let tick = self.tick + ai::INPUT_DELAY;
            if let Err(reason) = self.queue_input(id, tick, input, out) {
                logging::error(&reason);
            }
        }
    }

    /// Adds the initial NPCs to a new game. There are no clients yet, so no events are needed,
    /// and with no PCs the spawn points only need to be free
    fn populate_npcs(&mut self) {
        for _ in 0..self.rules.initial_npcs {
            let kind = self.next_npc_kind();
            if let Some(pos) = self.find_npc_spawn_point(kind) {
                self.add_npc(pos, kind);
            }
        }
        let npc_count = self.players.len();
        self.next_npc_spawn_tick = self.tick + next_spawn_time(npc_count);
    }

    /// The kind of the next NPC: an npc2 once there are enough npc1 for one more, otherwise an npc1
    fn next_npc_kind(&self) -> PlayerKind {
        let mut npc1 = 0;
        let mut npc2 = 0;
        for player in self.players.values() {
            match player.kind() {
                PlayerKind::Npc1 => npc1 += 1,
                PlayerKind::Npc2 => npc2 += 1,
                PlayerKind::Pc => {}
            }
        }
        if (npc2 + 1) * NPC1_PER_NPC2 <= npc1 {
            PlayerKind::Npc2
        } else {
            PlayerKind::Npc1
        }
    }

    /// Adds an NPC that spawns at the given position on the next tick
    fn add_npc(&mut self, pos: Position, kind: PlayerKind) -> PlayerId {
        let id = self.next_npc_id;
        self.next_npc_id += 1;
        let mut npc = Player::new(id, kind, NPC_SPRITE);
        // NPCs have no spawn animation
        npc.spawn_at(pos, 0);
        self.players.insert(id, npc);
        self.npc_ais.insert(id, NpcAi::new());
        id
    }

    /// Picks random points on the floor until one is free and far enough from every PC that's
    /// alive or spawning, or gives up after NPC_SPAWN_ATTEMPTS
    fn find_npc_spawn_point(&mut self, kind: PlayerKind) -> Option<Position> {
        let solidbox = self.rules.kind(kind).solidbox;
        for _ in 0..NPC_SPAWN_ATTEMPTS {
            let rng = self.next_rng();
            let pos = self.map.random_floor_point(rng)?;
            if self.map.is_blocked(&solidbox.at(pos)) {
                continue;
            }
            let near_pc = self.players.values().any(|p| {
                p.kind() == PlayerKind::Pc
                    && (p.alive() || p.spawn_timer() >= 0)
                    && (p.position().x - pos.x).abs() < MIN_DISTANCE_X
                    && (p.position().y - pos.y).abs() < MIN_DISTANCE_Y
            });
            if !near_pc {
                return Some(pos);
            }
        }
        None
    }

    /// Adds the shots fired up to the given tick to the output. If they don't all fit in the
    /// frame, the oldest ones are left out (they're still in the game, just not in the frame)
    fn push_shots(&self, out: &mut Output, fired_by: Tick) {
        let room = MAX_FRAME_ENTITIES.saturating_sub(out.entities.len());
        let fired = || {
            self.shots
                .values()
                .filter(move |s| s.spawn_tick() <= fired_by)
        };
        let count = fired().count();
        if count <= room {
            out.entities.extend(fired().map(Shot::to_entity));
            return;
        }
        logging::warn(&format!(
            "too many entities, {} of {count} shots left out of the frame",
            count - room
        ));
        let mut shots: Vec<&Shot> = fired().collect();
        // Newest first
        shots.sort_unstable_by_key(|s| Reverse((s.spawn_tick(), s.id())));
        out.entities
            .extend(shots.into_iter().take(room).map(Shot::to_entity));
    }

    // Not part of step_shots since it only happens in the server
    fn check_shot_collisions(&mut self, out: &mut Output) {
        let mut hits: Vec<(u32, PlayerId, PlayerId, Position)> = Vec::new();
        for shot in self.shots.values() {
            for player in self.players.values() {
                if player.alive()
                    && shot.shooter() != player.id()
                    && player.hurtbox().intersects(shot.hitbox())
                {
                    hits.push((shot.id(), shot.shooter(), player.id(), shot.position()));
                    break;
                }
            }
        }
        for (shot_id, shooter_id, player_id, pos) in hits {
            // If an earlier shot this tick killed the player, this one keeps flying
            let Some(player) = self.players.get_mut(&player_id).filter(|p| p.alive()) else {
                continue;
            };
            self.shots.remove(&shot_id);
            let damage = self.rules.bullet_damage;
            player.on_hit(damage);
            if !player.alive() {
                logging::debug(&format!(
                    "{} {player_id} killed by {shooter_id}",
                    player.kind().name()
                ));
            }
            out.events.push(
                ShotHitPlayer::new(
                    self.tick,
                    player_id,
                    player.hp(),
                    player.alive(),
                    shot_id,
                    pos,
                )
                .into_event(),
            );
            if player.alive() {
                continue;
            }
            let kind = player.kind();
            if kind == PlayerKind::Pc {
                // PCs lose their score when they die
                player.set_score(0);
                out.events
                    .push(ScoreUpdate::new(self.tick, player_id, 0).into_event());
            } else {
                // NPCs don't respawn, so they're removed as soon as they die
                self.players.remove(&player_id);
                self.npc_ais.remove(&player_id);
            }
            self.award_kill(shooter_id, kind, out);
        }
    }

    fn award_kill(&mut self, shooter_id: PlayerId, kind: PlayerKind, out: &mut Output) {
        let points = self.rules.kind(kind).points;
        let Some(shooter) = self
            .players
            .get_mut(&shooter_id)
            .filter(|p| p.kind() == PlayerKind::Pc)
        else {
            return;
        };
        let score = shooter.score() + points;
        shooter.set_score(score);
        out.events
            .push(ScoreUpdate::new(self.tick, shooter_id, score).into_event());
    }
}
