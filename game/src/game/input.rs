use super::Tick;
use std::collections::VecDeque;

// Packed byte layout: bits [1:0] = horizontal, bits [3:2] = vertical, bit 4 = fire,
// bit 5 = face only (the horizontal direction turns the player without moving it, only for NPCs)
// For axes: 0b00 = 0, 0b01 = 1, 0b10 = -1
pub const FIRE: u8 = 0b10000;
pub const FACE_ONLY: u8 = 0b100000;
#[derive(Default, Clone, Copy)]
#[allow(dead_code)]
pub struct Input {
    pub tick: Tick,
    pub horizontal: i8, // -1, 0, 1
    pub vertical: i8,   // -1, 0, 1
    pub fire: bool,
    pub face_only: bool,
}

impl Input {
    pub fn new(tick: Tick, packed: u8) -> Self {
        Self {
            tick,
            horizontal: unpack_axis(packed & 0b11),
            vertical: unpack_axis((packed >> 2) & 0b11),
            fire: packed & FIRE != 0,
            face_only: packed & FACE_ONLY != 0,
        }
    }

    /// The packed byte of the input, the opposite of new()
    pub fn packed(&self) -> u8 {
        pack_axis(self.horizontal)
            | (pack_axis(self.vertical) << 2)
            | ((self.fire as u8) << 4)
            | ((self.face_only as u8) << 5)
    }
}

#[inline]
fn pack_axis(value: i8) -> u8 {
    match value {
        1 => 0b01,
        -1 => 0b10,
        _ => 0b00,
    }
}

#[inline]
fn unpack_axis(bits: u8) -> i8 {
    match bits {
        0b01 => 1,
        0b10 => -1,
        _ => 0,
    }
}

pub struct InputQueue {
    queue: VecDeque<Input>,
    last: Input,
}

#[allow(dead_code)]
impl InputQueue {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            last: Input::default(),
        }
    }

    /// Returns the tick of the last known input (queued or already applied).
    pub fn last_known_tick(&self) -> Tick {
        self.queue.back().map_or(self.last.tick, |b| b.tick)
    }

    /// The input currently applied, followed by the ones queued for later ticks
    pub fn all(&self) -> impl Iterator<Item = &Input> {
        std::iter::once(&self.last).chain(self.queue.iter())
    }

    /// Adds an input to the back of the queue.
    pub fn push(&mut self, input: Input) {
        self.queue.push_back(input);
    }

    /// Returns the input active at the given tick. Drains all queue entries whose tick
    /// has passed, keeping the most recent one in `last` (inputs linger until superseded).
    pub fn get_current_input(&mut self, tick: Tick) -> &Input {
        while self.queue.front().is_some_and(|i| i.tick <= tick) {
            self.last = self.queue.pop_front().unwrap();
        }
        &self.last
    }

    /// Returns the input active at the given tick without consuming queue entries.
    pub fn peek_at(&self, tick: Tick) -> Input {
        let mut result = self.last;
        for input in &self.queue {
            if input.tick <= tick {
                result = *input;
            } else {
                break;
            }
        }
        result
    }
}
