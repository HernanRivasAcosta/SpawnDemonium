use crate::utils::codec::{Decode, Encode};
use crate::utils::types::{PlayerKind, Position};

#[allow(dead_code)]
#[repr(u8)]
pub enum EventType {
    Input = 1,
    PlayerSpawn = 2,
    PlayerJoin = 3,
    PlayerLeft = 4,
    PlayerShot = 5,
    ShotHit = 6, // Only used for the client to communicate with the renderer
    ShotHitPlayer = 7,
    ScoreUpdate = 8, // Only sent by the server
}

pub struct Event {
    pub event_type: EventType,
    pub data: Vec<u8>,
}

// InputEvent wire format (event_type = 1):
//
// meta:
//   endian: be
//
// seq:
//   - id: player_id
//     type: u4
//   - id: tick
//     type: u4
//   - id: raw_input
//     type: u1
//     doc: packed byte — bits [1:0] horizontal, bits [3:2] vertical, bit 4 fire, bit 5 face only

pub struct InputEvent {
    pub player_id: u32,
    pub tick: u32,
    pub raw_input: u8,
}

impl InputEvent {
    pub fn new(player_id: u32, tick: u32, raw_input: u8) -> Self {
        Self {
            player_id,
            tick,
            raw_input,
        }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(9);
        self.encode(&mut data);
        Event {
            event_type: EventType::Input,
            data,
        }
    }
}

impl Encode for InputEvent {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.player_id.encode(buf);
        self.tick.encode(buf);
        self.raw_input.encode(buf);
    }
}

impl Decode for InputEvent {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let player_id = u32::decode(data, offset);
        let tick = u32::decode(data, offset);
        let raw_input = u8::decode(data, offset);
        Self {
            player_id,
            tick,
            raw_input,
        }
    }
}

// PlayerJoin wire format (event_type = 3):
//
// meta:
//   endian: be
//
// seq:
//   - id: player_id
//     type: u4
//   - id: sprite
//     type: u1
//   - id: kind
//     type: u1
//     doc: 0 for PCs, 1 for npc1, 2 for npc2

// PlayerLeft wire format (event_type = 4):
//
// meta:
//   endian: be
//
// seq:
//   - id: player_id
//     type: u4

pub struct PlayerJoin {
    pub player_id: u32,
    pub sprite: u8,
    pub kind: PlayerKind,
}

impl PlayerJoin {
    pub fn new(player_id: u32, sprite: u8, kind: PlayerKind) -> Self {
        Self {
            player_id,
            sprite,
            kind,
        }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(6);
        self.encode(&mut data);
        Event {
            event_type: EventType::PlayerJoin,
            data,
        }
    }
}

impl Encode for PlayerJoin {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.player_id.encode(buf);
        self.sprite.encode(buf);
        self.kind.encode(buf);
    }
}

impl Decode for PlayerJoin {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        Self {
            player_id: u32::decode(data, offset),
            sprite: u8::decode(data, offset),
            kind: PlayerKind::decode(data, offset),
        }
    }
}

pub struct PlayerLeft {
    pub player_id: u32,
}

impl PlayerLeft {
    pub fn new(player_id: u32) -> Self {
        Self { player_id }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(4);
        self.encode(&mut data);
        Event {
            event_type: EventType::PlayerLeft,
            data,
        }
    }
}

impl Encode for PlayerLeft {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.player_id.encode(buf);
    }
}

impl Decode for PlayerLeft {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        Self {
            player_id: u32::decode(data, offset),
        }
    }
}

// PlayerSpawn event wire format (event_type = 2):
//
// meta:
//   endian: be
//
// seq:
//   - id: player_id
//     type: u4
//   - id: position_x
//     type: s4
//   - id: position_y
//     type: s4
//   - id: tick
//     type: u4
//   - id: sprite
//     type: u1

pub struct PlayerSpawn {
    pub player_id: u32,
    pub position: Position,
    pub tick: u32,
    pub sprite: u8,
}

impl PlayerSpawn {
    pub fn new(player_id: u32, position: Position, tick: u32, sprite: u8) -> Self {
        Self {
            player_id,
            position,
            tick,
            sprite,
        }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(17);
        self.encode(&mut data);
        Event {
            event_type: EventType::PlayerSpawn,
            data,
        }
    }
}

impl Encode for PlayerSpawn {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.player_id.encode(buf);
        self.position.encode(buf);
        self.tick.encode(buf);
        self.sprite.encode(buf);
    }
}

impl Decode for PlayerSpawn {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let player_id = u32::decode(data, offset);
        let position = Position::decode(data, offset);
        let tick = u32::decode(data, offset);
        let sprite = u8::decode(data, offset);
        Self {
            player_id,
            position,
            tick,
            sprite,
        }
    }
}

// PlayerShot wire format (event_type = 5):
//
// meta:
//   endian: be
//
// seq:
//   - id: tick
//     type: u4
//   - id: id
//     type: u4
//   - id: shooter_id
//     type: u4
//   - id: position_x
//     type: s4
//   - id: position_y
//     type: s4
//   - id: orientation
//     type: s1
//   - id: height
//     type: u1
//     doc: How far above the shooter's feet it flies, its shadow hits the walls
//   - id: sprite
//     type: u1

#[allow(dead_code)]
pub struct PlayerShot {
    pub tick: u32,
    pub id: u32,
    pub shooter_id: u32,
    pub position: Position,
    pub orientation: i8,
    pub height: u8,
    pub sprite: u8,
}

#[allow(dead_code)]
impl PlayerShot {
    pub fn new(
        tick: u32,
        id: u32,
        shooter_id: u32,
        position: Position,
        orientation: i8,
        height: u8,
        sprite: u8,
    ) -> Self {
        Self {
            tick,
            id,
            shooter_id,
            position,
            orientation,
            height,
            sprite,
        }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(19);
        self.encode(&mut data);
        Event {
            event_type: EventType::PlayerShot,
            data,
        }
    }
}

impl Encode for PlayerShot {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.tick.encode(buf);
        self.id.encode(buf);
        self.shooter_id.encode(buf);
        self.position.encode(buf);
        self.orientation.encode(buf);
        self.height.encode(buf);
        self.sprite.encode(buf);
    }
}

impl Decode for PlayerShot {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let tick = u32::decode(data, offset);
        let id = u32::decode(data, offset);
        let shooter_id = u32::decode(data, offset);
        let position = Position::decode(data, offset);
        let orientation = i8::decode(data, offset);
        let height = u8::decode(data, offset);
        let sprite = u8::decode(data, offset);
        Self {
            tick,
            id,
            shooter_id,
            position,
            orientation,
            height,
            sprite,
        }
    }
}

// ShotHit wire format (event_type = 6):
//
// meta:
//   endian: be
//
// seq:
//   - id: tick
//     type: u4
//   - id: id
//     type: u4
//   - id: position_x
//     type: s4
//   - id: position_y
//     type: s4

pub struct ShotHit {
    pub tick: u32,
    pub id: u32,
    pub position: Position,
}

#[allow(dead_code)]
impl ShotHit {
    pub fn new(tick: u32, id: u32, position: Position) -> Self {
        Self { tick, id, position }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(16);
        self.encode(&mut data);
        Event {
            event_type: EventType::ShotHit,
            data,
        }
    }
}

impl Encode for ShotHit {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.tick.encode(buf);
        self.id.encode(buf);
        self.position.encode(buf);
    }
}

impl Decode for ShotHit {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let tick = u32::decode(data, offset);
        let id = u32::decode(data, offset);
        let position = Position::decode(data, offset);
        Self { tick, id, position }
    }
}

// ShotHitPlayer wire format (event_type = 7):
//
// meta:
//   endian: be
//
// seq:
//   - id: tick
//     type: u4
//   - id: player_id
//     type: u4
//   - id: hp
//     type: u1
//     doc: The HP the player was left with, 0 if the shot killed it
//   - id: alive
//     type: u1
//   - id: shot_id
//     type: u4
//   - id: position_x
//     type: s4
//   - id: position_y
//     type: s4

pub struct ShotHitPlayer {
    pub tick: u32,
    pub player_id: u32,
    pub hp: u8,
    pub alive: bool,
    pub shot_id: u32,
    pub position: Position,
}

#[allow(dead_code)]
impl ShotHitPlayer {
    pub fn new(
        tick: u32,
        player_id: u32,
        hp: u8,
        alive: bool,
        shot_id: u32,
        position: Position,
    ) -> Self {
        Self {
            tick,
            player_id,
            hp,
            alive,
            shot_id,
            position,
        }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(22);
        self.encode(&mut data);
        Event {
            event_type: EventType::ShotHitPlayer,
            data,
        }
    }
}

impl Encode for ShotHitPlayer {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.tick.encode(buf);
        self.player_id.encode(buf);
        self.hp.encode(buf);
        self.alive.encode(buf);
        self.shot_id.encode(buf);
        self.position.encode(buf);
    }
}

impl Decode for ShotHitPlayer {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let tick = u32::decode(data, offset);
        let player_id = u32::decode(data, offset);
        let hp = u8::decode(data, offset);
        let alive = bool::decode(data, offset);
        let shot_id = u32::decode(data, offset);
        let position = Position::decode(data, offset);
        Self {
            tick,
            player_id,
            hp,
            alive,
            shot_id,
            position,
        }
    }
}

// ScoreUpdate wire format (event_type = 8):
//
// meta:
//   endian: be
//
// seq:
//   - id: tick
//     type: u4
//   - id: player_id
//     type: u4
//   - id: score
//     type: u4

pub struct ScoreUpdate {
    pub tick: u32,
    pub player_id: u32,
    pub score: u32,
}

#[allow(dead_code)]
impl ScoreUpdate {
    pub fn new(tick: u32, player_id: u32, score: u32) -> Self {
        Self {
            tick,
            player_id,
            score,
        }
    }

    pub fn into_event(self) -> Event {
        let mut data = Vec::with_capacity(12);
        self.encode(&mut data);
        Event {
            event_type: EventType::ScoreUpdate,
            data,
        }
    }
}

impl Encode for ScoreUpdate {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.tick.encode(buf);
        self.player_id.encode(buf);
        self.score.encode(buf);
    }
}

impl Decode for ScoreUpdate {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let tick = u32::decode(data, offset);
        let player_id = u32::decode(data, offset);
        let score = u32::decode(data, offset);
        Self {
            tick,
            player_id,
            score,
        }
    }
}
