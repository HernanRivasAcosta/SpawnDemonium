use crate::FRAME;
use crate::utils::events::Event;

// Format:
//
// meta:
//   endian: be
//
// seq:
//   - id: event_bytes
//     type: u2
//     doc: Total byte size of the events section (num_events + all event data)
//   - id: num_events
//     type: u1
//   - id: events
//     type: event
//     repeat: expr
//     repeat-expr: num_events
//   - id: entity_bytes
//     type: u2
//     doc: Total byte size of the entities section (num_entities + all entity data)
//   - id: num_entities
//     type: u1
//   - id: entities
//     type: entity
//     repeat: expr
//     repeat-expr: num_entities
//   - id: metadata_bytes
//     type: u2
//     doc: Total byte size of the metadata section (raw bytes, caller-defined layout)
//   - id: metadata
//     size: metadata_bytes
//
// types:
//   event:
//     seq:
//       - id: event_len
//         type: u1
//         doc: The size of the event in bytes (including type byte)
//       - id: event_type
//         type: u1
//       - id: data
//         size: event_len - 1
//   entity:
//     seq:
//       - id: entity_len
//         type: u1
//         doc: The size of the entity in bytes (including type byte)
//       - id: entity_type
//         type: u1
//       - id: data
//         size: entity_len - 1

// The number of entities in a frame is a single byte
pub const MAX_FRAME_ENTITIES: usize = u8::MAX as usize;

#[allow(dead_code)]
#[repr(u8)]
pub enum EntityType {
    Player = 1,
    Shot = 2,
}

pub struct Entity {
    pub entity_type: EntityType,
    pub data: Vec<u8>,
}

pub struct Output {
    pub events: Vec<Event>,
    pub entities: Vec<Entity>,
    pub metadata: Vec<u8>,
}

impl Output {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            entities: Vec::new(),
            metadata: Vec::new(),
        }
    }

    pub fn flush(self) {
        let buf = unsafe { &mut *FRAME.0.get() };
        buf.clear();

        // Reserve 2 bytes for event_bytes, fill in after writing events
        buf.extend([0, 0, 0]);
        let event_bytes_index = buf.len() - 3;
        let num_events_index = buf.len() - 1;
        for event in self.events {
            buf[num_events_index] = buf[num_events_index].saturating_add(1);
            buf.push(1 + event.data.len() as u8);
            buf.push(event.event_type as u8);
            buf.extend_from_slice(&event.data);
        }
        let event_bytes = (buf.len() - event_bytes_index - 2) as u16;
        let [hi, lo] = event_bytes.to_be_bytes();
        buf[event_bytes_index] = hi;
        buf[event_bytes_index + 1] = lo;

        // Reserve 2 bytes for entity_bytes, fill in after writing entities
        buf.extend([0, 0, 0]);
        let entity_bytes_index = buf.len() - 3;
        let num_entities_index = buf.len() - 1;
        for entity in self.entities {
            buf[num_entities_index] = buf[num_entities_index].saturating_add(1);
            buf.push(1 + entity.data.len() as u8);
            buf.push(entity.entity_type as u8);
            buf.extend_from_slice(&entity.data);
        }
        let entity_bytes = (buf.len() - entity_bytes_index - 2) as u16;
        let [hi, lo] = entity_bytes.to_be_bytes();
        buf[entity_bytes_index] = hi;
        buf[entity_bytes_index + 1] = lo;

        let metadata_len = self.metadata.len() as u16;
        let [hi, lo] = metadata_len.to_be_bytes();
        buf.push(hi);
        buf.push(lo);
        buf.extend_from_slice(&self.metadata);
    }
}
