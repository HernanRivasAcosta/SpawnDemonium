#![allow(dead_code)]
#![allow(clippy::upper_case_acronyms)]

use std::ops::Add;

pub use crate::utils::types::Position;

// Velocity

#[derive(Copy, Clone, PartialEq)]
pub struct Velocity {
    pub x: i32,
    pub y: i32,
}

impl Add for Velocity {
    type Output = Velocity;

    fn add(self, other: Velocity) -> Velocity {
        Velocity {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}

impl Velocity {
    pub fn null() -> Self {
        Self { x: 0, y: 0 }
    }

    pub fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }
}

// AABB

#[derive(Copy, Clone, PartialEq, Debug)]
pub struct AABB {
    pub pos: Position,
    pub w: i32,
    pub h: i32,
}

impl AABB {
    pub fn null() -> Self {
        Self {
            pos: Position::at_origin(),
            w: 0,
            h: 0,
        }
    }

    pub fn new(pos: Position, w: i32, h: i32) -> Self {
        Self { pos, w, h }
    }

    pub fn at(&self, offset: Position) -> Self {
        Self {
            pos: Position {
                x: self.pos.x + offset.x,
                y: self.pos.y + offset.y,
            },
            w: self.w,
            h: self.h,
        }
    }

    pub fn intersects(&self, other: &AABB) -> bool {
        self.pos.x < other.pos.x + other.w
            && self.pos.x + self.w > other.pos.x
            && self.pos.y < other.pos.y + other.h
            && self.pos.y + self.h > other.pos.y
    }
}
