defmodule Spawndemonium.HighScores do
  @moduledoc """
  The best scores reached in any game since the server started. They're only kept in memory.

  Player ids are only unique within a game, so the entries are keyed by game id and player id.
  Names aren't unique, so the same name can take several entries, like in an arcade.

  Every change to the table is broadcast as `{:high_scores, [{name, score}]}`, see `subscribe/0`.
  """
  use GenServer

  alias Spawndemonium.GameHandler

  @max_entries 5
  @topic "high_scores"
  # Fake scores so the table is never empty. They have no game, so no player can replace them
  @default_entries [
    %{game_id: nil, player_id: 0, name: "HER", score: 750},
    %{game_id: nil, player_id: 1, name: "XXX", score: 700},
    %{game_id: nil, player_id: 2, name: "AAA", score: 450}
  ]

  @type table :: [{String.t(), non_neg_integer()}]
  @type entry :: %{
          game_id: GameHandler.game_id() | nil,
          player_id: GameHandler.player_id(),
          name: String.t(),
          score: non_neg_integer()
        }

  # Client API

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, [], opts)
  end

  @doc """
  Reports a player's current score. It only makes it into the table if it's one of the best, and
  it replaces the player's previous entry if it's higher.
  """
  @spec report(GameHandler.game_id(), GameHandler.player_id(), String.t(), non_neg_integer()) ::
          :ok
  def report(game_id, player_id, name, score) do
    GenServer.cast(__MODULE__, {:report, game_id, player_id, name, score})
  end

  @doc """
  Returns the table as name and score pairs, best score first.
  """
  @spec top() :: table()
  def top() do
    GenServer.call(__MODULE__, :top)
  end

  @doc """
  Sends `{:high_scores, table}` to the calling process every time the table changes.
  """
  @spec subscribe() :: :ok
  def subscribe() do
    :ok = Phoenix.PubSub.subscribe(Spawndemonium.PubSub, @topic)
  end

  # Server callbacks

  @impl true
  def init([]) do
    {:ok, @default_entries}
  end

  @impl true
  def handle_cast({:report, game_id, player_id, name, score}, entries) do
    entry = %{game_id: game_id, player_id: player_id, name: name, score: score}

    case insert(entries, entry) do
      ^entries ->
        {:noreply, entries}

      new_entries ->
        :ok =
          Phoenix.PubSub.broadcast(
            Spawndemonium.PubSub,
            @topic,
            {:high_scores, to_table(new_entries)}
          )

        {:noreply, new_entries}
    end
  end

  @impl true
  def handle_call(:top, _from, entries) do
    {:reply, to_table(entries), entries}
  end

  # Helpers

  @spec to_table([entry()]) :: table()
  defp to_table(entries) do
    for %{name: name, score: score} <- entries, do: {name, score}
  end

  # Adds the entry unless the player already has a better one in the table, then keeps the best
  # @max_entries. Ties keep the older entry first, since it got there first
  @spec insert([entry()], entry()) :: [entry()]
  defp insert(entries, %{game_id: game_id, player_id: player_id, score: score} = entry) do
    case Enum.find(entries, &(&1.game_id == game_id and &1.player_id == player_id)) do
      %{score: previous} when previous >= score ->
        entries

      previous ->
        (List.delete(entries, previous) ++ [entry])
        |> Enum.sort_by(& &1.score, :desc)
        |> Enum.take(@max_entries)
    end
  end
end
