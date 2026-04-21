defmodule Spawndemonium.GameHandler.Game do
  @moduledoc """
  This module contains helper functions and mappings for the rust code
  """
  require Logger

  alias Spawndemonium.GameHandler
  alias Spawndemonium.GameHandler.WasmUtils

  @type pointer :: non_neg_integer()
  @type event :: binary()
  @type events :: [event()]
  # The entities and metadata are never decoded because the server doesn't care, just forwards them
  @type entities :: binary()
  @type metadata :: binary()

  @spec initialise(binary(), WasmUtils.wasm_state()) :: :ok | {:error, term()}
  def initialise(map_data, wasm_state) do
    # Prepend 4-byte big-endian length to the map data and 2 bytes indicating
    # for the length of the game initialisation data (which is empty on servers)

    # The initialisation data consists of the following:
    # meta:
    #   endian: be
    #
    # seq:
    #   - id: initial_tick
    #     type: u4
    #     doc: The initial tick number should be non zero since tick 0 is used to indicate errors
    #   - id: map_data_len
    #     type: u4
    #     doc: The length of the map data in bytes
    #   - id: map_data
    #     type: bytes
    #     size: map_data_len
    #   - id: init_data_len
    #     type: u2
    #     doc: The length of the game initialisation data in bytes (which is 0 for servers)
    #   - id: metadata_len
    #     type: u2
    #     doc: The length of the metadata in bytes
    #   - id: metadata
    #     doc: For servers the metadata contains the initial tick (u4, always 1) and the rng seed (u8)
    seed = :crypto.strong_rand_bytes(8) |> :binary.decode_unsigned(:big)

    initial_tick = 1

    initialisation_data =
      <<byte_size(map_data)::32-big, map_data::binary, 0::16-big, 12::16-big,
        initial_tick::32-big, seed::64-big>>

    map_ptr = alloc(byte_size(initialisation_data), wasm_state)
    :ok = WasmUtils.write(map_ptr, initialisation_data, wasm_state)
    result = call_wasm_function(wasm_state, "initialise_server", [map_ptr])
    :ok = dealloc(map_ptr, wasm_state)

    case result do
      {:ok, [^initial_tick]} ->
        :ok

      {:ok, [bad_tick]} ->
        # This should never happen
        Logger.error("The wasm server initialised with an invalid initial tick: #{bad_tick}")
        {:error, :initialisation_failed}

      {:error, reason} = error ->
        Logger.error("Failed to initialise server: #{inspect(reason)}")
        error
    end
  end

  @spec add_player(WasmUtils.wasm_state(), GameHandler.player_id()) ::
          {:ok, events(), entities(), metadata()} | {:error, any()}
  def add_player(wasm_state, player_id) do
    case call_wasm_function(wasm_state, "add_player", [player_id]) do
      {:ok, [0]} -> get_frame(wasm_state)
      {:ok, [1]} -> {:error, :add_player_failed}
      {:error, _} = error -> error
    end
  end

  @doc """
  Returns the state a new client needs to start, without adding a player to the game.
  """
  @spec get_state(WasmUtils.wasm_state()) :: {:ok, entities(), metadata()} | {:error, any()}
  def get_state(wasm_state) do
    case call_wasm_function(wasm_state, "get_state", []) do
      {:ok, [0]} ->
        {:ok, [], entities, metadata} = get_frame(wasm_state)
        {:ok, entities, metadata}

      {:ok, [1]} ->
        {:error, :get_state_failed}

      {:error, _} = error ->
        error
    end
  end

  @spec remove_player(WasmUtils.wasm_state(), GameHandler.player_id()) ::
          {:ok, events()} | {:error, any()}
  def remove_player(wasm_state, player_id) do
    case call_wasm_function(wasm_state, "remove_player", [player_id]) do
      {:ok, [0]} ->
        {:ok, events, _, _} = get_frame(wasm_state)
        {:ok, events}

      {:ok, [1]} ->
        {:error, :remove_player_failed}

      {:error, _} = error ->
        error
    end
  end

  @spec player_input(WasmUtils.wasm_state(), GameHandler.player_id(), integer(), integer()) ::
          {:ok, events()} | {:error, any()}
  def player_input(wasm_state, player_id, tick, input) do
    case call_wasm_function(wasm_state, "player_input", [player_id, tick, input]) do
      {:ok, [0]} ->
        {:ok, events, _, _} = get_frame(wasm_state)
        {:ok, events}

      {:ok, [1]} ->
        {:error, :bad_input}

      {:error, _} = error ->
        error
    end
  end

  @spec spawn_player(WasmUtils.wasm_state(), GameHandler.player_id(), non_neg_integer()) ::
          {:ok, events()} | {:error, any()}
  def spawn_player(wasm_state, player_id, tick) do
    case call_wasm_function(wasm_state, "spawn_player", [player_id, tick]) do
      {:ok, [0]} ->
        {:ok, events, _, _} = get_frame(wasm_state)
        {:ok, events}

      {:ok, [1]} ->
        {:error, :spawn_failed}

      {:error, _} = error ->
        error
    end
  end

  @spec tick(WasmUtils.wasm_state()) ::
          {:ok, integer(), events()} | {:error, term()}
  def tick(wasm_state) do
    case call_wasm_function(wasm_state, "server_tick", []) do
      {:ok, [tick]} ->
        {:ok, events, _, _} = get_frame(wasm_state)
        {:ok, tick, events}

      {:error, reason} = error ->
        Logger.error("Failed to execute tick: #{inspect(reason)}")
        error
    end
  end

  @spec alloc(non_neg_integer(), WasmUtils.wasm_state()) :: pointer()
  def alloc(num_bytes, wasm_state) do
    {:ok, [ptr]} = Wasmex.call_function(wasm_state.pid, "alloc", [num_bytes])
    ptr
  end

  @spec dealloc(pointer(), WasmUtils.wasm_state()) :: :ok
  def dealloc(ptr, wasm_state) do
    {:ok, []} = Wasmex.call_function(wasm_state.pid, "dealloc", [ptr])
    :ok
  end

  # Helper functions

  defp call_wasm_function(wasm_state, fn_name, args) do
    result = Wasmex.call_function(wasm_state.pid, fn_name, args)
    :ok = print_wasm_logs(wasm_state)
    result
  end

  @spec print_wasm_logs(WasmUtils.wasm_state()) :: :ok
  defp print_wasm_logs(wasm_state) do
    # The wasm logs are stored in the following format:
    #
    # meta:
    #   endian: be
    #
    # enums:
    #   log_level:
    #     0: debug
    #     1: info
    #     2: warn
    #     3: error
    #
    # seq:
    #   - id: num_logs
    #     type: u1
    #     doc: The number of log entries
    #   - id: log_entries
    #     type: log_entry
    #     repeat: expr
    #     repeat-expr: num_logs
    #     doc: The log entries
    #
    # types:
    #   log_entry:
    #     seq:
    #       - id: log_level
    #         type: u1
    #         enum: log_level
    #         doc: The log level
    #       - id: log_len
    #         type: u2
    #         doc: The length of the log message in bytes
    #       - id: log
    #         type: str
    #         size: log_len
    #         doc: The log message as a UTF-8 string
    {:ok, [log_ptr]} = Wasmex.call_function(wasm_state.pid, "log", [])
    <<num_logs::8-unsigned>> = WasmUtils.read(log_ptr, 1, wasm_state)

    :ok =
      Stream.unfold({num_logs, log_ptr + 1}, fn
        {0, _ptr} ->
          nil

        {n, ptr} ->
          <<log_level::8-unsigned, log_len::16-unsigned>> = WasmUtils.read(ptr, 3, wasm_state)

          msg = WasmUtils.read(ptr + 3, log_len, wasm_state)
          {{log_level, msg}, {n - 1, ptr + 3 + log_len}}
      end)
      |> Enum.each(fn {log_level, msg} -> :ok = wasm_log(log_level, msg) end)
  end

  @spec get_frame(WasmUtils.wasm_state()) :: {:ok, [binary()], binary(), binary()}
  defp get_frame(wasm_state) do
    # The server output is stored in the following format:
    #
    # meta:
    #   endian: be
    #
    # seq:
    #   - id: event_bytes
    #     type: u2
    #     doc: Total byte size of the events section (num_events + all event data)
    #   - id: num_events
    #     type: u1
    #   - id: events
    #     type: event
    #     repeat: expr
    #     repeat-expr: num_events
    #   - id: entity_bytes
    #     type: u2
    #     doc: Total byte size of the entities section (num_entities + all entity data)
    #   - id: num_entities
    #     type: u1
    #   - id: entities
    #     type: entity
    #     repeat: expr
    #     repeat-expr: num_entities
    #   - id: metadata_bytes
    #     type: u2
    #     doc: Total byte size of the metadata section (raw bytes, caller-defined layout)
    #   - id: metadata
    #     size: metadata_bytes
    #
    # types:
    #   event:
    #     seq:
    #       - id: event_len
    #         type: u1
    #         doc: The size of the event in bytes (including type byte)
    #       - id: event_type
    #         type: u1
    #       - id: data
    #         size: event_len - 1
    #   entity:
    #     seq:
    #       - id: entity_len
    #         type: u1
    #         doc: The size of the entity in bytes (including type byte)
    #       - id: entity_type
    #         type: u1
    #       - id: data
    #         size: entity_len - 1
    {:ok, [server_out_ptr]} = Wasmex.call_function(wasm_state.pid, "frame", [])

    <<event_bytes::16-unsigned>> = WasmUtils.read(server_out_ptr, 2, wasm_state)

    events =
      case event_bytes do
        0 -> []
        _ -> parse_events(WasmUtils.read(server_out_ptr + 2, event_bytes, wasm_state))
      end

    <<entity_bytes::16-unsigned>> =
      WasmUtils.read(server_out_ptr + 2 + event_bytes, 2, wasm_state)

    entities_bin = WasmUtils.read(server_out_ptr + 2 + event_bytes + 2, entity_bytes, wasm_state)

    <<metadata_bytes::16-unsigned>> =
      WasmUtils.read(server_out_ptr + 2 + event_bytes + 2 + entity_bytes, 2, wasm_state)

    metadata_bin =
      WasmUtils.read(
        server_out_ptr + 2 + event_bytes + 2 + entity_bytes + 2,
        metadata_bytes,
        wasm_state
      )

    {:ok, events, entities_bin, metadata_bin}
  end

  defp wasm_log(0, msg), do: Logger.debug("[WASM] #{msg}")
  defp wasm_log(1, msg), do: Logger.info("[WASM] #{msg}")
  defp wasm_log(2, msg), do: Logger.warning("[WASM] #{msg}")
  defp wasm_log(3, msg), do: Logger.error("[WASM] #{msg}")

  defp parse_events(<<num_events::8-unsigned, data::binary>>) do
    parse_events(num_events, data, [])
  end

  defp parse_events(0, _data, acc) do
    # The order doesn't really matter, but we reverse just in case
    Enum.reverse(acc)
  end

  defp parse_events(
         n,
         <<event_len::8-unsigned, event::binary-size(event_len), rest::binary>>,
         acc
       ) do
    parse_events(n - 1, rest, [event | acc])
  end
end
