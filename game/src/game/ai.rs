use super::geom::Position;
use super::input::{FIRE, Input};
use super::player::PlayerId;
use super::{KindRules, Tick, next_random};

// How far NPCs see PCs, 0.45 of the screen (360x240) so the PCs see them first
const SIGHT_X: i32 = 162;
const SIGHT_Y: i32 = 108;

// The NPCs decide their inputs this many ticks ahead, so they reach the clients before they're
// applied and the clients don't have to correct the NPCs' positions (like a PC with some latency)
pub const INPUT_DELAY: Tick = 5;
// Raw inputs for right, left, down and up (see the packed layout in input.rs). The order matters:
// for a direction i, i ^ 1 is the opposite one, and i ^ 2 and i ^ 3 are the orthogonal ones
const DIRECTIONS: [u8; 4] = [0b0001, 0b0010, 0b0100, 0b1000];
// Out of 4, how often a new direction is horizontal
const HORIZONTAL_ODDS: u64 = 3;
// Out of 4, how often an NPC that walked into a wall turns back, otherwise it turns to a side
const TURN_BACK_ODDS: u64 = 3;
// After walking into a wall, the NPC only walks this percentage of a usual walk, so it gets away
// from the wall without hugging the next one
const BOUNCE_PERCENT: Tick = 25;
// How far (in pixels) the NPC's shots can be from the middle of its target to count as aligned.
// The PCs' hurtbox is 22px tall, so this leaves room for the target moving
const ALIGN_TOLERANCE: i32 = 4;
// Once aligned, the NPC holds still and fires: two quick shots, a pause, two more and another pause.
// These are the ticks it fires on, counted from when it aligned, and when it decides again
const FIRE_TICKS: [Tick; 4] = [0, 4, 19, 23];
const HOLD_TICKS: Tick = 38;

/// How long NPCs of a kind walk in the same direction, picked at random between both
pub struct WanderRules {
    pub min_ticks: Tick,
    pub max_ticks: Tick,
}

/// Wanders until it sees a PC: walks in axis aligned directions (mostly horizontal ones) for a
/// random time, and turns as soon as it walks into a wall. Once it has a target, it faces it and
/// moves vertically until its shots are at the target's height, then holds still while it fires
/// (see FIRE_TICKS) and decides again
pub struct NpcAi {
    // Index into DIRECTIONS, None until the first update
    direction: Option<usize>,
    ticks_left: Tick,
    // Ticks until the last decision is applied (see INPUT_DELAY). Until then the NPC keeps doing
    // what it was doing, so it may stay against a wall for a bit, but it shouldn't decide again
    pending_ticks: Tick,
    // The last input sent while aligning, and its vertical direction
    align_input: Option<u8>,
    align_vertical: i8,
    // Ticks since it started holding still and firing, nothing changes until it's over, not even
    // the target
    hold_tick: Option<Tick>,
    // Set when a hold ends, the target is picked again even if the current one is still in sight
    retarget: bool,
    // Where the NPC was on the previous update, to know if a wall stopped it
    last_position: Position,
    // The PC it's aligning with, if it has seen one
    target: Option<PlayerId>,
}

impl NpcAi {
    pub fn new() -> Self {
        Self {
            direction: None,
            ticks_left: 0,
            pending_ticks: 0,
            align_input: None,
            align_vertical: 0,
            hold_tick: None,
            retarget: false,
            last_position: Position::at_origin(),
            target: None,
        }
    }

    pub fn target(&self) -> Option<PlayerId> {
        self.target
    }

    /// Looks for PCs (the alive ones, as id and position). While aligning it doesn't switch
    /// targets, it goes back to wandering if the target is out of sight. While holding it doesn't
    /// look at all. Otherwise (wandering or after a hold) it picks the PC in sight closest in X.
    /// Returns true if the target changed
    pub fn look(&mut self, position: Position, pcs: &[(PlayerId, Position)]) -> bool {
        if self.hold_tick.is_some() {
            return false;
        }
        let in_sight = |pc: &Position| {
            (pc.x - position.x).abs() <= SIGHT_X && (pc.y - position.y).abs() <= SIGHT_Y
        };
        let previous = self.target;
        match previous {
            Some(target) if !self.retarget => {
                if pcs.iter().any(|(id, pc)| *id == target && in_sight(pc)) {
                    return false;
                }
                self.target = None;
            }
            _ => {
                self.retarget = false;
                self.target = pcs
                    .iter()
                    .filter(|(_, pc)| in_sight(pc))
                    .min_by_key(|(_, pc)| (pc.x - position.x).abs())
                    .map(|(id, _)| *id);
            }
        }
        match (previous, self.target) {
            (Some(_), None) => {
                // Picks a new direction as soon as possible
                self.direction = None;
                self.ticks_left = 0;
            }
            (None, Some(_)) => {
                // Its current movement isn't an aligning one, so the first one has to be sent
                self.align_input = None;
                self.align_vertical = 0;
            }
            _ => {}
        }
        self.target != previous
    }

    /// Called every tick while the NPC is alive, after look(). Returns the raw input when it
    /// changes, which is meant to be applied INPUT_DELAY ticks later. `pcs` are the alive PCs and
    /// `aim_offset` the middle of their hurtbox, relative to their position
    pub fn update(
        &mut self,
        position: Position,
        rules: &KindRules,
        pcs: &[(PlayerId, Position)],
        aim_offset: i32,
        rng: &mut u64,
    ) -> Option<u8> {
        // The hold doesn't wait for the pending input, its shots don't change the movement
        if let Some(tick) = self.hold_tick {
            let tick = tick + 1;
            if tick < HOLD_TICKS {
                self.hold_tick = Some(tick);
                // Its input while holding is the last aligning one, the one that stopped it
                return FIRE_TICKS
                    .contains(&tick)
                    .then(|| self.align_input.unwrap_or(0) | FIRE);
            }
            self.hold_tick = None;
            self.retarget = true;
            // The input that stopped it was applied long ago, the pending ticks weren't counted
            // down while holding
            self.pending_ticks = 0;
            return None;
        }
        if self.pending_ticks > 0 {
            self.pending_ticks -= 1;
            self.last_position = position;
            return None;
        }
        let target = self
            .target
            .and_then(|target| pcs.iter().find(|(id, _)| *id == target));
        let input = match target {
            Some((_, target)) => self.align(position, *target, aim_offset, rules),
            None => self.wander(position, rules, rng),
        };
        if input.is_some() {
            self.pending_ticks = INPUT_DELAY;
        }
        input
    }

    /// Faces the target and moves vertically until its shots would hit the middle of it
    fn align(
        &mut self,
        position: Position,
        target: Position,
        aim_offset: i32,
        rules: &KindRules,
    ) -> Option<u8> {
        let horizontal = if target.x < position.x { -1 } else { 1 };
        // Nothing else is pending (see update), so it keeps moving like this until the new input
        // is applied. Walls are ignored, if there's one in the way it stays against it
        let speed = rules.speed.y * self.align_vertical as i32;
        let arrival = position.y + speed * INPUT_DELAY as i32;
        // Where its feet have to be so its shots fly at the target's middle
        let dy = target.y + aim_offset + rules.shot.height as i32 - arrival;
        let tolerance = ALIGN_TOLERANCE.max(rules.speed.y);
        let aligned = dy.abs() <= tolerance;
        let vertical = if aligned { 0 } else { dy.signum() as i8 };
        let input = Input {
            horizontal,
            vertical,
            face_only: true,
            ..Default::default()
        }
        .packed();
        let changed = self.align_input != Some(input);
        self.align_input = Some(input);
        self.align_vertical = vertical;
        if aligned {
            // It stops and fires the first shot with the same input. If it was already still, it
            // only fires
            self.hold_tick = Some(0);
            return Some(input | FIRE);
        }
        changed.then_some(input)
    }

    fn wander(&mut self, position: Position, rules: &KindRules, rng: &mut u64) -> Option<u8> {
        let rules = &rules.wander;
        // A wall collision undoes the whole step, so a stopped NPC is exactly where it was
        let blocked = self.direction.is_some() && position == self.last_position;
        self.last_position = position;
        let (direction, ticks) = match self.direction {
            Some(current) if blocked => {
                let direction = if roll(rng, 4) < TURN_BACK_ODDS {
                    current ^ 1
                } else {
                    current ^ 2 ^ roll(rng, 2) as usize
                };
                (direction, walk_ticks(rules, rng) * BOUNCE_PERCENT / 100)
            }
            _ if self.ticks_left > 0 => {
                self.ticks_left -= 1;
                return None;
            }
            _ => {
                // Horizontal directions are 0 and 1, vertical ones 2 and 3
                let axis = if roll(rng, 4) < HORIZONTAL_ODDS { 0 } else { 2 };
                (axis + roll(rng, 2) as usize, walk_ticks(rules, rng))
            }
        };
        self.ticks_left = ticks.max(1);
        // Picking the direction it's already walking in means it keeps going
        if self.direction == Some(direction) {
            return None;
        }
        self.direction = Some(direction);
        Some(DIRECTIONS[direction])
    }
}

fn walk_ticks(rules: &WanderRules, rng: &mut u64) -> Tick {
    rules.min_ticks + roll(rng, (rules.max_ticks - rules.min_ticks + 1) as u64) as Tick
}

/// A random number from 0 to n - 1
fn roll(rng: &mut u64, n: u64) -> u64 {
    // We have to use the high bits because the low ones repeat too much
    (next_random(rng) >> 32) % n
}
