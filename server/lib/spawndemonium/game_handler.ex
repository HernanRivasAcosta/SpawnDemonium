defmodule Spawndemonium.GameHandler do
  use GenServer

  require Logger

  alias Spawndemonium.GameHandler.Game
  alias Spawndemonium.GameHandler.WasmUtils
  alias Spawndemonium.HighScores
  alias Spawndemonium.Utils.GameTimer

  @type game_id :: non_neg_integer()
  @type player_id :: non_neg_integer()
  @type players :: %{
          pid() => %{
            id: player_id(),
            name: String.t(),
            ref: reference(),
            # Spectators don't take a player slot and their inputs are ignored
            spectating: boolean()
          }
        }
  @type state :: %{
          game_id: game_id(),
          wasm_state: WasmUtils.wasm_state(),
          next_player_id: player_id(),
          players: players(),
          current_tick: integer(),
          timer_ref: reference()
        }

  @max_players 8
  # Spectators aren't part of the game, so they all have the same invalid id
  @spectator_id 0
  @tick_rate 40

  # Client API

  @spec start_monitor(game_id(), keyword()) ::
          {:ok, pid(), reference()} | {:error, term()}
  def start_monitor(game_id, opts \\ []) do
    case GenServer.start(__MODULE__, [game_id], opts) do
      {:ok, game_pid} -> {:ok, game_pid, Process.monitor(game_pid)}
      error -> error
    end
  end

  @spec available?(pid()) :: boolean()
  def available?(game_pid) do
    GenServer.call(game_pid, :available?)
  end

  @doc """
  Adds a player to the game. Spectators can always join, since they don't take a player slot.
  """
  @spec join(pid(), pid(), String.t(), boolean()) ::
          {:ok, %{player_id: player_id(), players: %{player_id() => String.t()}, state: map()}}
          | {:error, :full}
  def join(game_pid, player_pid, player_name, spectating) do
    # The name is already validated at this point, so we can accept it
    GenServer.call(game_pid, {:join, player_pid, player_name, spectating})
  end

  @spec spawn_player(pid(), pid(), non_neg_integer()) :: :ok | {:error, any()}
  def spawn_player(game_pid, player_pid, tick) do
    GenServer.call(game_pid, {:spawn_player, player_pid, tick})
  end

  @spec player_input(pid(), pid(), integer(), integer()) ::
          :ok | {:error, any()}
  def player_input(game_pid, player_pid, tick, input) do
    GenServer.call(game_pid, {:player_input, player_pid, tick, input})
  end

  @doc """
  Lists everyone connected to the game, spectators included, sorted by player id.
  """
  @spec list_players(pid()) :: [%{id: player_id(), name: String.t(), spectating: boolean()}]
  def list_players(game_pid) do
    GenServer.call(game_pid, :list_players)
  end

  @doc """
  Returns the pid of the player's socket. Spectators can't be found, they all share the same id.
  """
  @spec find_player(pid(), player_id()) :: {:ok, pid()} | {:error, :player_not_found}
  def find_player(game_pid, player_id) do
    GenServer.call(game_pid, {:find_player, player_id})
  end

  # Server callbacks

  @impl true
  def init([game_id]) do
    wasm_bytes = load_wasm()
    {:ok, wasm_state} = WasmUtils.initialise(wasm_bytes)

    Logger.info("[game #{game_id}] Initialising")
    map_data = load_map()

    case Game.initialise(map_data, wasm_state) do
      :ok ->
        Logger.info("[game #{game_id}] Initialised")
        {:ok, timer_ref} = :timer.send_interval(GameTimer.ms_per_tick(@tick_rate), :tick)

        {:ok,
         %{
           game_id: game_id,
           wasm_state: wasm_state,
           next_player_id: 1,
           players: %{},
           current_tick: 0,
           timer_ref: timer_ref
         }}

      {:error, _reason} = error ->
        error
    end
  end

  @impl true
  def handle_call(:available?, _from, state) do
    {:reply, active_players(state.players) < @max_players, state}
  end

  def handle_call(:list_players, _from, state) do
    players =
      state.players
      |> Enum.map(fn {_pid, player} -> Map.take(player, [:id, :name, :spectating]) end)
      |> Enum.sort_by(& &1.id)

    {:reply, players, state}
  end

  def handle_call({:find_player, player_id}, _from, state) do
    case Enum.find(state.players, fn {_pid, player} ->
           player.id == player_id and not player.spectating
         end) do
      {player_pid, _player} -> {:reply, {:ok, player_pid}, state}
      nil -> {:reply, {:error, :player_not_found}, state}
    end
  end

  @impl true
  def handle_call(
        {:join, player_pid, player_name, spectating},
        _from,
        %{
          players: players,
          next_player_id: next_player_id,
          wasm_state: wasm_state
        } = state
      ) do
    if not spectating and active_players(players) >= @max_players do
      {:reply, {:error, :full}, state}
    else
      case add_to_game(wasm_state, players, next_player_id, spectating) do
        {:ok, player_id, entities_bin, metadata_bin} ->
          # Monitor the player process so we can clean up if they disconnect
          ref = Process.monitor(player_pid)
          # Update the player list
          new_players =
            Map.put(players, player_pid, %{
              id: player_id,
              ref: ref,
              name: player_name,
              spectating: spectating
            })

          # Create the initialisation data for the new joiner
          map_data = load_map()

          initial_wasm_state =
            <<byte_size(map_data)::32-big, map_data::binary, byte_size(entities_bin)::16-big,
              entities_bin::binary, byte_size(metadata_bin)::16-big, metadata_bin::binary>>

          # Welcome message, spectators aren't listed since they're not in the game
          initial_msg = %{
            player_id: player_id,
            players:
              for(
                {_pid, %{id: id, name: name, spectating: false}} <- new_players,
                into: %{},
                do: {id, name}
              ),
            state: %{
              tick: 0,
              wasm_state: initial_wasm_state
            }
          }

          # Reply with the welcome message and the updated state
          {:reply, {:ok, initial_msg},
           %{
             state
             | next_player_id: if(spectating, do: next_player_id, else: next_player_id + 1),
               players: new_players
           }}

        {:error, _reason} = error ->
          Logger.error("[game #{state.game_id}] Failed to add player, reason: #{inspect(error)}")
          {:reply, {:error, :internal_error}, state}
      end
    end
  end

  def handle_call(
        {:player_input, player_pid, desired_tick, input},
        _from,
        %{players: players, wasm_state: wasm_state} = state
      ) do
    case Map.fetch(players, player_pid) do
      {:ok, %{spectating: true}} ->
        {:reply, :ok, state}

      {:ok, %{id: player_id}} ->
        case Game.player_input(wasm_state, player_id, desired_tick, input) do
          {:ok, events} ->
            :ok = broadcast({:events, events}, Map.keys(players))
            {:reply, :ok, state}

          {:error, _reason} = error ->
            {:reply, error, state}
        end

      :error ->
        Logger.warning(
          "[game #{state.game_id}] Received input from unknown player #{inspect(player_pid)}"
        )

        {:reply, {:error, :unknown_player}, state}
    end
  end

  def handle_call(
        {:spawn_player, player_pid, tick},
        _from,
        %{players: players, wasm_state: wasm_state} = state
      ) do
    case Map.fetch(players, player_pid) do
      {:ok, %{spectating: true}} ->
        {:reply, :ok, state}

      {:ok, %{id: player_id}} ->
        case Game.spawn_player(wasm_state, player_id, tick) do
          {:ok, events} ->
            :ok = broadcast({:events, events}, Map.keys(players))
            {:reply, :ok, state}

          {:error, _reason} = error ->
            {:reply, error, state}
        end

      :error ->
        Logger.warning(
          "[game #{state.game_id}] Received spawn request from unknown player #{inspect(player_pid)}"
        )

        {:reply, {:error, :unknown_player}, state}
    end
  end

  @impl true
  def handle_info(:tick, %{players: players} = state) do
    case Game.tick(state.wasm_state) do
      {:ok, tick, events} ->
        :ok = broadcast({:tick, tick, events}, Map.keys(players))
        :ok = report_scores(state.game_id, events, players)
        {:noreply, state}

      {:error, _reason} = _error ->
        # TODO: Notify players of the error
        {:stop, :normal, state}
    end
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, %{players: players} = state) do
    {pid, %{id: player_id, spectating: spectating}} =
      Enum.find(players, fn {_pid, %{ref: player_ref}} -> player_ref == ref end)

    new_players = Map.delete(players, pid)

    if map_size(new_players) == 0 do
      Logger.info("[game #{state.game_id}] All players left, shutting down")
      {:stop, :normal, %{state | players: new_players}}
    else
      if spectating do
        Logger.debug("[game #{state.game_id}] Spectator left")
      else
        :ok = remove_from_game(state, player_id, new_players)
      end

      {:noreply, %{state | players: new_players}}
    end
  end

  @impl true
  def terminate(_reason, state) do
    :timer.cancel(state.timer_ref)
  end

  # Helpers

  # Removes a player from the game and notifies everyone else
  @spec remove_from_game(state(), player_id(), players()) :: :ok
  defp remove_from_game(state, player_id, new_players) do
    Logger.debug("[game #{state.game_id}] Player left, #{map_size(new_players)} remaining")
    # Remove the player from the game
    case Game.remove_player(state.wasm_state, player_id) do
      {:ok, events} ->
        :ok = broadcast({:events, events}, Map.keys(new_players))
        Logger.debug("[game #{state.game_id}] Player removed from game")

      {:error, _reason} = error ->
        Logger.error("[game #{state.game_id}] Failed to remove player, reason: #{inspect(error)}")
    end

    :ok
  end

  # Spectators only need the state, players are added to the game and announced to everyone else
  @spec add_to_game(WasmUtils.wasm_state(), players(), player_id(), boolean()) ::
          {:ok, player_id(), Game.entities(), Game.metadata()} | {:error, any()}
  defp add_to_game(wasm_state, _players, _next_player_id, true) do
    with {:ok, entities_bin, metadata_bin} <- Game.get_state(wasm_state) do
      {:ok, @spectator_id, entities_bin, metadata_bin}
    end
  end

  defp add_to_game(wasm_state, players, player_id, false) do
    with {:ok, events, entities_bin, metadata_bin} <- Game.add_player(wasm_state, player_id) do
      # Send the event(s) to the existing players and spectators (if any)
      :ok = broadcast({:events, events}, Map.keys(players))
      {:ok, player_id, entities_bin, metadata_bin}
    end
  end

  # Sends the new scores in the ScoreUpdate events to the high score table. Scores only change on
  # ticks, and the events are the only part of the frame the server reads
  @spec report_scores(game_id(), Game.events(), players()) :: :ok
  defp report_scores(game_id, events, players) do
    # ScoreUpdate wire format (event_type = 8): tick (u4), player_id (u4), score (u4). Zeroes are
    # skipped, they only mean someone died
    for <<8, _tick::32, player_id::32, score::32>> <- events, score > 0 do
      case Enum.find(players, fn {_pid, %{id: id}} -> id == player_id end) do
        {_pid, %{name: name}} -> :ok = HighScores.report(game_id, player_id, name, score)
        # Shouldn't happen, players leave the Rust game in the same call they leave the map
        nil -> :ok
      end
    end

    :ok
  end

  # The number of players (spectators don't count) taking a slot
  @spec active_players(players()) :: non_neg_integer()
  defp active_players(players) do
    Enum.count(players, fn {_pid, %{spectating: spectating}} -> not spectating end)
  end

  # The paths are resolved at runtime, module attributes would point to where it was compiled,
  # which doesn't exist on the server when deploying a release
  defp load_wasm() do
    File.read!(Application.app_dir(:spawndemonium, "priv/wasm/game.wasm"))
  end

  defp load_map() do
    File.read!(Application.app_dir(:spawndemonium, "priv/maps/main.map"))
  end

  defp broadcast(msg, to) do
    Enum.each(to, fn ref ->
      send(ref, msg)
    end)
  end
end
