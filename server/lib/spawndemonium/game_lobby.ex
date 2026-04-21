defmodule Spawndemonium.GameLobby do
  use GenServer

  require Logger

  alias Spawndemonium.GameHandler

  @type state :: %{
          games: [{non_neg_integer(), pid(), reference()}],
          next_game_id: non_neg_integer(),
          expletive_config: any()
        }

  # Client API

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, [], opts)
  end

  # Returns the pid of an available game and the player's assigned ID
  # creates a game if none exist. Spectators join any game, even full ones
  @spec join_game(String.t(), boolean()) :: {:ok, pid(), non_neg_integer()} | {:error, term()}
  def join_game(player_name, spectating) do
    GenServer.call(__MODULE__, {:join_game, player_name, spectating})
  end

  # Returns the id and pid of every running game, oldest first
  @spec list_games() :: [{GameHandler.game_id(), pid()}]
  def list_games() do
    GenServer.call(__MODULE__, :list_games)
  end

  # Server callbacks

  @impl true
  def init([]) do
    {:ok,
     %{
       games: [],
       next_game_id: 0,
       expletive_config: Expletive.configure(blacklist: Expletive.Blacklist.international())
     }}
  end

  @impl true
  def handle_call(
        {:join_game, player_name, spectating},
        {player_pid, _other},
        %{expletive_config: expletive_config} = state
      ) do
    with {:ok, player_name} <- validate_player_name(player_name, expletive_config),
         {game_pid, state} = get_or_create_game(state, spectating),
         {:ok, reply} <- GameHandler.join(game_pid, player_pid, player_name, spectating) do
      {:reply, {:ok, game_pid, reply}, state}
    else
      {:error, _} = error -> {:reply, error, state}
    end
  end

  def handle_call(:list_games, _from, state) do
    games =
      state.games
      |> Enum.map(fn {game_id, game_pid, _ref} -> {game_id, game_pid} end)
      |> Enum.sort()

    {:reply, games, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    games = Enum.reject(state.games, fn {_game_id, _game, game_ref} -> game_ref == ref end)
    {:noreply, %{state | games: games}}
  end

  # Helpers

  # Finds a game with a free slot, or any game for spectators, and creates one if there's none
  @spec get_or_create_game(state(), boolean()) :: {pid(), state()}
  defp get_or_create_game(state, spectating) do
    case Enum.find(state.games, fn {_game_id, game, _ref} ->
           spectating or GameHandler.available?(game)
         end) do
      nil ->
        game_id = state.next_game_id
        {:ok, game_pid, ref} = GameHandler.start_monitor(game_id)
        Logger.debug("Created game #{game_id}")
        games = [{game_id, game_pid, ref} | state.games]
        {game_pid, %{state | games: games, next_game_id: game_id + 1}}

      {_game_id, game_pid, _ref} ->
        {game_pid, state}
    end
  end

  defp validate_player_name(name, expletive_config) do
    uppercased = String.upcase(name)

    cond do
      not Regex.match?(~r/^[A-Z0-9]{1,9}$/, uppercased) ->
        {:error, :invalid_player_name}

      # Expletive expects lowercase input
      Expletive.profane?(String.downcase(uppercased), expletive_config) ->
        {:error, :invalid_player_name}

      true ->
        {:ok, uppercased}
    end
  end
end
