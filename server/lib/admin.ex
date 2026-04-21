defmodule Admin do
  @moduledoc """
  Functions to inspect and control the server from a remote shell, e.g. `Admin.list_games()`.

  It's not namespaced under `Spawndemonium` so the calls are short to type.
  """

  alias Spawndemonium.GameHandler
  alias Spawndemonium.GameLobby
  alias SpawndemoniumWeb.GameSocket

  @doc """
  Lists the running games with how many players and spectators each one has.
  """
  @spec list_games() :: [
          %{id: GameHandler.game_id(), players: non_neg_integer(), spectators: non_neg_integer()}
        ]
  def list_games() do
    for {game_id, game_pid} <- GameLobby.list_games(),
        {:ok, players} <- [safe_list_players(game_pid)] do
      spectators = Enum.count(players, & &1.spectating)
      %{id: game_id, players: length(players) - spectators, spectators: spectators}
    end
  end

  @doc """
  Lists everyone connected to a game, spectators included.
  """
  @spec list_players(GameHandler.game_id()) ::
          [%{id: GameHandler.player_id(), name: String.t(), spectating: boolean()}]
          | {:error, :game_not_found}
  def list_players(game_id) do
    with {:ok, game_pid} <- find_game(game_id),
         {:ok, players} <- safe_list_players(game_pid) do
      players
    end
  end

  @doc """
  Delays every message from a player by `lag_ms` before it reaches the game, 0 removes the lag.
  """
  @spec lag(GameHandler.game_id(), GameHandler.player_id(), non_neg_integer()) ::
          :ok | {:error, :game_not_found | :player_not_found}
  def lag(game_id, player_id, lag_ms) when is_integer(lag_ms) and lag_ms >= 0 do
    with {:ok, game_pid} <- find_game(game_id),
         {:ok, player_pid} <- safe_find_player(game_pid, player_id) do
      :ok = GameSocket.set_lag(player_pid, lag_ms)
    end
  end

  # Helpers

  @spec find_game(GameHandler.game_id()) :: {:ok, pid()} | {:error, :game_not_found}
  defp find_game(game_id) do
    case List.keyfind(GameLobby.list_games(), game_id, 0) do
      {^game_id, game_pid} -> {:ok, game_pid}
      nil -> {:error, :game_not_found}
    end
  end

  # The game can shut down between the lobby listing it and the call, it's treated as not found
  @spec safe_list_players(pid()) ::
          {:ok, [%{id: GameHandler.player_id(), name: String.t(), spectating: boolean()}]}
          | {:error, :game_not_found}
  defp safe_list_players(game_pid) do
    {:ok, GameHandler.list_players(game_pid)}
  catch
    :exit, _ -> {:error, :game_not_found}
  end

  @spec safe_find_player(pid(), GameHandler.player_id()) ::
          {:ok, pid()} | {:error, :game_not_found | :player_not_found}
  defp safe_find_player(game_pid, player_id) do
    GameHandler.find_player(game_pid, player_id)
  catch
    :exit, _ -> {:error, :game_not_found}
  end
end
