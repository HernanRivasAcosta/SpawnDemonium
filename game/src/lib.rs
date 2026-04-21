mod game;
mod logging;
mod utils;
use game::GameState;
use game::Tick;
use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::ptr::addr_of_mut;

// Internal game state

static mut GAME_STATE: MaybeUninit<GameState> = MaybeUninit::uninit();

// Outputs

struct SyncUnsafeCell<T>(UnsafeCell<T>);
unsafe impl<T> Sync for SyncUnsafeCell<T> {}

static LOG: SyncUnsafeCell<Vec<u8>> = SyncUnsafeCell(UnsafeCell::new(Vec::new()));
static FRAME: SyncUnsafeCell<Vec<u8>> = SyncUnsafeCell(UnsafeCell::new(Vec::new()));

// Memory pointers

#[unsafe(no_mangle)]
pub extern "C" fn log() -> *const u8 {
    unsafe { (*LOG.0.get()).as_ptr() }
}

#[unsafe(no_mangle)]
pub extern "C" fn frame() -> *const u8 {
    unsafe { (*FRAME.0.get()).as_ptr() }
}

// Main API

/// Allocates `size` bytes and returns a pointer to them.
/// Stores `size` as a u32 in the 4 bytes before the returned pointer so
/// `dealloc` can free the allocation without the caller tracking the size.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(size + 4);
    let base = buf.as_mut_ptr();
    std::mem::forget(buf);
    unsafe {
        *(base as *mut u32) = size as u32;
        base.add(4)
    }
}

/// Frees memory previously allocated by `alloc`.
/// # Safety
/// `ptr` must have been returned by `alloc` and not yet freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8) {
    unsafe {
        let base = ptr.sub(4);
        let size = *(base as *const u32) as usize;
        drop(Vec::from_raw_parts(base, 0, size + 4));
    }
}

/// Initialises the game server, returns true if there was an error
#[unsafe(no_mangle)]
pub extern "C" fn initialise_server(map_ptr: *const u8) -> Tick {
    logging::clear_logs();
    logging::debug("initialising server");
    unsafe {
        if map_ptr.is_null() {
            logging::error("initialise_server: map_ptr is null");
            return 0;
        }

        GAME_STATE = MaybeUninit::new(GameState::new(true, map_ptr));
        logging::debug("server initialised");
        // Return the initial tick
        let state: &mut GameState = get_game_state();
        state.get_tick()
    }
}

/// Initialises the client
#[unsafe(no_mangle)]
pub extern "C" fn initialise_client(server_data_ptr: *const u8) -> Tick {
    logging::clear_logs();
    logging::debug("initialising client");
    unsafe {
        GAME_STATE = MaybeUninit::new(GameState::new(false, server_data_ptr));
    }
    logging::debug("client initialised");
    let state: &mut GameState = get_game_state();
    state.get_tick()
}

/// Adds a player to the game, returns true if there was an error
#[unsafe(no_mangle)]
pub extern "C" fn add_player(player_id: u32) -> bool {
    logging::clear_logs();
    logging::debug(&format!("adding player {player_id}"));

    let state = get_game_state();
    match state.add_player(player_id) {
        Ok(()) => {
            logging::debug(&format!("player {player_id} added successfully"));
            false
        }
        Err(reason) => {
            logging::error(&reason);
            true
        }
    }
}

/// Removes a player from the game, returns true if there was an error
#[unsafe(no_mangle)]
pub extern "C" fn remove_player(player_id: u32) -> bool {
    logging::clear_logs();
    logging::debug(&format!("removing player {player_id}"));

    let state = get_game_state();
    match state.remove_player(player_id) {
        Ok(()) => {
            logging::debug(&format!("player {player_id} removed successfully"));
            false
        }
        Err(reason) => {
            logging::error(&reason);
            true
        }
    }
}

/// Outputs the state, returns true if there was an error
#[unsafe(no_mangle)]
pub extern "C" fn get_state() -> bool {
    logging::clear_logs();

    let state = get_game_state();
    match state.get_state() {
        Ok(()) => false,
        Err(reason) => {
            logging::error(&reason);
            true
        }
    }
}

/// Called when a player instends to spawn
#[unsafe(no_mangle)]
pub extern "C" fn spawn_player(player_id: u32, tick: Tick) -> bool {
    logging::clear_logs();

    let state = get_game_state();
    match state.spawn_player(player_id, tick) {
        Ok(()) => false,
        Err(reason) => {
            logging::error(&reason);
            true
        }
    }
}

/// Called when there's a user input, returns true if there was an error
#[unsafe(no_mangle)]
pub extern "C" fn player_input(player_id: u32, tick: Tick, input: u8) -> bool {
    logging::clear_logs();
    let state = get_game_state();
    match state.player_input(player_id, tick, input) {
        Ok(()) => false,
        Err(reason) => {
            logging::error(&reason);
            true
        }
    }
}

/// Performs a tick on either the server or the client
#[unsafe(no_mangle)]
pub extern "C" fn server_tick() -> Tick {
    logging::clear_logs();
    let state: &mut GameState = get_game_state();
    state.server_tick()
}

#[unsafe(no_mangle)]
pub extern "C" fn client_tick(last_server_tick: Tick, events_ptr: *const u8) -> Tick {
    logging::clear_logs();
    let state: &mut GameState = get_game_state();
    state.client_tick(last_server_tick, events_ptr)
}

// Utils

fn get_game_state() -> &'static mut GameState {
    // addr_of_mut! avoids creating a direct &mut to the static (UB in Rust 2024)
    unsafe { (*addr_of_mut!(GAME_STATE)).assume_init_mut() }
}
