use crate::logging;
use crate::utils::codec::{Decode, Encode};

#[derive(Copy, Clone, PartialEq, Debug)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[allow(dead_code)]
impl Position {
    pub fn at_origin() -> Self {
        Self { x: 0, y: 0 }
    }

    pub fn at(x: i32, y: i32) -> Self {
        Self { x, y }
    }

    pub fn translated(&self, dx: i32, dy: i32) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
        }
    }
}

impl Encode for Position {
    fn encode(&self, buf: &mut Vec<u8>) {
        self.x.encode(buf);
        self.y.encode(buf);
    }
}

impl Decode for Position {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        Self {
            x: i32::decode(data, offset),
            y: i32::decode(data, offset),
        }
    }
}

/// Who controls a player: a client (PC) or the server (NPC)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum PlayerKind {
    Pc = 0,
    Npc1 = 1,
    Npc2 = 2,
}

impl PlayerKind {
    /// Name used in the logs
    pub fn name(&self) -> &'static str {
        match self {
            PlayerKind::Pc => "pc",
            PlayerKind::Npc1 => "npc1",
            PlayerKind::Npc2 => "npc2",
        }
    }
}

impl Encode for PlayerKind {
    fn encode(&self, buf: &mut Vec<u8>) {
        (*self as u8).encode(buf);
    }
}

impl Decode for PlayerKind {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        match u8::decode(data, offset) {
            0 => PlayerKind::Pc,
            1 => PlayerKind::Npc1,
            2 => PlayerKind::Npc2,
            kind => {
                logging::warn(&format!("invalid player kind {kind}"));
                PlayerKind::Pc
            }
        }
    }
}
