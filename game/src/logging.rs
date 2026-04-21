use std::panic::Location;

use super::LOG;

// Format:
//
// meta:
//   endian: be
//
// enums:
//   log_level:
//     0: debug
//     1: info
//     2: warn
//     3: error
//
// seq:
//   - id: num_logs
//     type: u1
//     doc: The number of log entries
//   - id: log_entries
//     type: log_entry
//     repeat: expr
//     repeat-expr: num_logs
//     doc: The log entries
//
// types:
//   log_entry:
//     seq:
//       - id: log_level
//         type: u1
//         enum: log_level
//         doc: The log level
//       - id: log_len
//         type: u2
//         doc: The length of the log message in bytes
//       - id: log
//         type: str
//         size: log_len
//         doc: The log message as a UTF-8 string

pub fn clear_logs() {
    unsafe {
        let log = &mut *LOG.0.get();
        log.clear();
        // Add the number of entries
        log.push(0);
    }
}

#[allow(dead_code)]
#[track_caller]
pub fn debug(_msg: &str) {
    #[cfg(debug_logging)]
    {
        let loc = Location::caller();
        push_entry(0, &format!("[{}:{}] {}", loc.file(), loc.line(), _msg));
    }
}

#[allow(dead_code)]
#[track_caller]
pub fn info(msg: &str) {
    let loc = Location::caller();
    push_entry(1, &format!("[{}:{}] {}", loc.file(), loc.line(), msg));
}

#[allow(dead_code)]
#[track_caller]
pub fn warn(msg: &str) {
    let loc = Location::caller();
    push_entry(2, &format!("[{}:{}] {}", loc.file(), loc.line(), msg));
}

#[allow(dead_code)]
#[track_caller]
pub fn error(msg: &str) {
    let loc = Location::caller();
    push_entry(3, &format!("[{}:{}] {}", loc.file(), loc.line(), msg));
}

#[inline]
fn push_entry(severity: u8, msg: &str) {
    let buf = unsafe { &mut *LOG.0.get() };
    let bytes = msg.as_bytes();
    let len = bytes.len().min(u16::MAX as usize) as u16;

    // byte 0 is always the count, set by clear_logs
    buf[0] = buf[0].saturating_add(1);

    buf.push(severity);
    buf.push((len >> 8) as u8);
    buf.push((len & 0xFF) as u8);
    buf.extend_from_slice(&bytes[..len as usize]);
}
