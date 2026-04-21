#![allow(dead_code)]

use super::geom::{AABB, Position, Velocity};
use super::player::PlayerId;
use super::{Rules, Tick};
use crate::utils::codec::{Decode, Encode};
use crate::utils::frame::{Entity, EntityType};

pub const WIDTH: i32 = 4;
pub const HEIGHT: i32 = 2;

#[derive(Clone, Copy)]
pub struct ShotKind {
    // How far above the shooter's feet it flies comes out of
    pub height: u8,
    // Only for the client, the bullet's sprite (bullet1 to bullet4)
    pub sprite: u8,
}

// Relative hitbox, centered on the shot's position
const HITBOX: AABB = AABB {
    pos: Position {
        x: -WIDTH / 2,
        y: -HEIGHT / 2,
    },
    w: WIDTH,
    h: HEIGHT,
};

pub struct Shot {
    shooter: PlayerId,
    id: u32,
    position: Position,
    velocity: Velocity,
    hitbox: AABB,
    pub sprite: u8,
    damage: u8,
    spawn_tick: Tick,
    // How far above the shooter's feet it flies (see ShotKind)
    height: u8,
}

impl Shot {
    pub fn new(
        shooter: PlayerId,
        id: u32,
        position: Position,
        orientation: i8,
        spawn_tick: Tick,
        kind: ShotKind,
        rules: &Rules,
    ) -> Self {
        Self {
            shooter,
            id,
            position,
            velocity: Velocity {
                x: orientation as i32 * rules.shot_speed,
                y: 0,
            },
            hitbox: HITBOX.at(position),
            sprite: kind.sprite,
            damage: rules.bullet_damage,
            spawn_tick,
            height: kind.height,
        }
    }

    pub fn from_entity(e: Entity) -> Self {
        Self::decode(&e.data, &mut 0)
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn position(&self) -> Position {
        self.position
    }

    pub fn spawn_tick(&self) -> Tick {
        self.spawn_tick
    }

    pub fn shooter(&self) -> PlayerId {
        self.shooter
    }

    pub fn damage(&self) -> u8 {
        self.damage
    }

    pub fn hitbox(&self) -> &AABB {
        &self.hitbox
    }

    /// Moves the shot by its velocity and returns true if its shadow collided with a wall
    pub fn step(&mut self, tick: Tick, walls: &[AABB]) -> bool {
        // Do nothing (and return false) if the shot has not reached its spawn tick
        if tick < self.spawn_tick {
            return false;
        }
        self.position.x += self.velocity.x;
        self.position.y += self.velocity.y;
        self.hitbox = HITBOX.at(self.position);
        // The walls are footprints on the ground, so they're checked against the shot's shadow
        // instead of its position
        let shadow = HITBOX.at(self.position.translated(0, self.height as i32 - 1));
        walls.iter().any(|w| shadow.intersects(w))
    }

    pub fn to_entity(&self) -> Entity {
        let mut data = Vec::with_capacity(19);
        self.encode(&mut data);
        Entity {
            entity_type: EntityType::Shot,
            data,
        }
    }
}

// Shot wire format (entity_type = 2):
//
// meta:
//   endian: be
//
// seq:
//   - id: id
//     type: u4
//   - id: spawn_tick
//     type: u4
//   - id: position_x
//     type: s4
//   - id: position_y
//     type: s4
//   - id: velocity_x
//     type: s4
//   - id: velocity_y
//     type: s4
//   - id: sprite
//     type: u1
//   - id: damage
//     type: u1
//   - id: height
//     type: u1
//     doc: How far above the shooter's feet it flies, its shadow hits the walls

impl Encode for Shot {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.id.encode(buf);
        self.spawn_tick.encode(buf);
        self.position.x.encode(buf);
        self.position.y.encode(buf);
        self.velocity.x.encode(buf);
        self.velocity.y.encode(buf);
        self.sprite.encode(buf);
        self.damage.encode(buf);
        self.height.encode(buf);
    }
}

impl Decode for Shot {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let id = u32::decode(data, offset);
        let spawn_tick = Tick::decode(data, offset);
        let position = Position {
            x: i32::decode(data, offset),
            y: i32::decode(data, offset),
        };
        let velocity = Velocity {
            x: i32::decode(data, offset),
            y: i32::decode(data, offset),
        };
        let sprite = u8::decode(data, offset);
        let damage = u8::decode(data, offset);
        let height = u8::decode(data, offset);
        Self {
            // The shooter isn't sent, the clients don't need it since the server checks the hits
            shooter: 0,
            id,
            spawn_tick,
            position,
            velocity,
            hitbox: HITBOX.at(position),
            sprite,
            damage,
            height,
        }
    }
}
