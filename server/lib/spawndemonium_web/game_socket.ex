defmodule SpawndemoniumWeb.GameSocket do
  require Logger

  @behaviour WebSock

  alias Spawndemonium.GameHandler
  alias Spawndemonium.GameLobby
  alias Spawndemonium.HighScores
  alias Spawndemonium.Utils.GameTimer

  @status_waiting :waiting
  @status_connected :connected
  @status_in_game :in_game

  @type status :: :waiting | :connected | :in_game
  @type frame :: {:binary, binary()}
  # Messages waiting for the fake lag to pass, last_due is when the newest one is due
  @type lag_queue(item) :: %{items: :queue.queue(item), last_due: integer()}
  @type state :: %{
          status: status(),
          game: pid() | nil,
          client_config: map(),
          events: [binary()],
          # Fake lag added from Admin, see set_lag/2
          lag_ms: non_neg_integer(),
          lagged_in: lag_queue(binary()),
          lagged_out: lag_queue(frame())
        }

  # Client API

  @doc """
  Delays every message from and to the client by `lag_ms`, 0 removes the lag. It's applied in
  each direction, so the round trip of a request goes up by twice the lag.
  """
  @spec set_lag(pid(), non_neg_integer()) :: :ok
  def set_lag(socket_pid, lag_ms) do
    send(socket_pid, {:set_lag, lag_ms})
    :ok
  end

  # WebSock callbacks

  @impl true
  @spec init(term()) :: {:ok, map()}
  def init(_opts) do
    Logger.debug("Client #{inspect(self())} connecting")

    {:ok,
     %{
       status: @status_waiting,
       game: nil,
       client_config: %{timeout: 20_000},
       events: [],
       lag_ms: 0,
       lagged_in: new_lag_queue(),
       lagged_out: new_lag_queue()
     }}
  end

  @impl true
  @spec handle_in({binary(), keyword()}, state()) ::
          {:ok, state()} | {:push, frame(), state()} | {:stop, :normal, state()}
  def handle_in({raw_msg, _opts}, state) do
    if lagged?(state.lagged_in, state.lag_ms) do
      {:ok, %{state | lagged_in: delay(state.lagged_in, raw_msg, state.lag_ms, :lagged_in)}}
    else
      handle_raw_msg(raw_msg, state)
    end
  end

  @spec handle_raw_msg(binary(), state()) ::
          {:ok, state()} | {:push, frame(), state()} | {:stop, :normal, state()}
  defp handle_raw_msg(raw_msg, state) do
    # This intentionally crashes on malformed messages and new atoms
    {:req, client_time, msg} = :erlang.binary_to_term(raw_msg, [:safe])

    case handle_request(msg, client_time, state) do
      {:ok, reply, new_state} ->
        push(reply, new_state)

      # {:ok, new_state} ->
      #  {:ok, new_state}

      {:disconnect, reason} ->
        Logger.info("Disconnecting player, reason: \"#{inspect(reason)}\"")
        {:stop, :normal, state}
    end
  end

  @impl true
  @spec handle_info(term(), state()) ::
          {:ok, state()} | {:push, frame(), state()} | {:stop, :normal, state()}
  def handle_info({:tick, tick, tick_events}, %{events: events} = state) do
    # The order of the events should not matter, but we keep it consistent anyway
    server_events = Enum.reverse(events) ++ tick_events
    push(build_message({:tick, tick, server_events}), %{state | events: []})
  end

  def handle_info({:events, new_events}, %{events: old_events} = state) do
    {:ok, %{state | events: Enum.reverse(new_events) ++ old_events}}
  end

  # Only sent to spectators
  def handle_info({:high_scores, scores}, state) do
    push(build_message({:high_scores, scores}), state)
  end

  def handle_info({:set_lag, lag_ms}, state) do
    Logger.info("Client #{inspect(self())} lag set to #{lag_ms}ms")
    {:ok, %{state | lag_ms: lag_ms}}
  end

  # One of these is sent per delayed message, see delay/4
  def handle_info(:lagged_in, state) do
    {raw_msg, lagged_in} = pop_lagged(state.lagged_in)
    handle_raw_msg(raw_msg, %{state | lagged_in: lagged_in})
  end

  def handle_info(:lagged_out, state) do
    {frame, lagged_out} = pop_lagged(state.lagged_out)
    {:push, frame, %{state | lagged_out: lagged_out}}
  end

  def handle_info(msg, state) do
    Logger.warning("Received unexpected message: #{inspect(msg)}")
    {:ok, state}
  end

  @impl true
  @spec terminate(term(), map()) :: :ok
  def terminate(reason, _state) do
    :ok = Logger.debug("Client #{inspect(self())} disconnected, reason: #{inspect(reason)}")
  end

  # Client request handlers

  def handle_request(:connection_request, client_time, %{status: @status_waiting} = state) do
    {:ok, build_reply(client_time, {:connected, %{config: state.client_config}}),
     %{state | status: @status_connected}}
  end

  def handle_request(:ping, client_time, state) do
    {:ok, build_reply(client_time), state}
  end

  def handle_request({:join, name, spectating}, client_time, %{status: @status_connected} = state)
      when is_boolean(spectating) do
    case GameLobby.join_game(name, spectating) do
      {:ok, game, reply} ->
        :ok = if spectating, do: watch_high_scores(), else: :ok

        {:ok, build_reply(client_time, {:joined, reply}),
         %{state | game: game, status: @status_in_game}}

      {:error, reason} ->
        {:disconnect, reason}
    end
  end

  def handle_request(
        {:input, tick, input},
        client_time,
        %{status: @status_in_game, game: game} = state
      ) do
    case GameHandler.player_input(game, self(), tick, input) do
      :ok ->
        {:ok, build_reply(client_time), state}

      {:error, reason} ->
        {:disconnect, reason}
    end
  end

  def handle_request({:spawn, tick}, client_time, %{status: @status_in_game, game: game} = state) do
    case GameHandler.spawn_player(game, self(), tick) do
      :ok ->
        {:ok, build_reply(client_time), state}

      {:error, reason} ->
        {:disconnect, reason}
    end
  end

  def handle_request(msg, _client_time, %{status: status}) do
    Logger.info("Client sent invalid message '#{inspect(msg)}' on state #{status}")
    {:disconnect, {:invalid_message, msg}}
  end

  # Helpers

  # Gets the current table, then every change to it, as {:high_scores, scores} messages. The first
  # one is queued so it's pushed after the join reply
  @spec watch_high_scores() :: :ok
  defp watch_high_scores() do
    :ok = HighScores.subscribe()
    send(self(), {:high_scores, HighScores.top()})
    :ok
  end

  # Sends a frame to the client, after the fake lag if there's any
  @spec push(frame(), state()) :: {:ok, state()} | {:push, frame(), state()}
  defp push(frame, state) do
    if lagged?(state.lagged_out, state.lag_ms) do
      {:ok, %{state | lagged_out: delay(state.lagged_out, frame, state.lag_ms, :lagged_out)}}
    else
      {:push, frame, state}
    end
  end

  # The monotonic clock is usually negative, so last_due can't start at 0 or every item would be due
  # after it
  @spec new_lag_queue() :: lag_queue(any())
  defp new_lag_queue(), do: %{items: :queue.new(), last_due: System.monotonic_time(:millisecond)}

  # Messages delayed before the lag was removed still have to go first
  @spec lagged?(lag_queue(any()), non_neg_integer()) :: boolean()
  defp lagged?(lag_queue, lag_ms), do: lag_ms > 0 or not :queue.is_empty(lag_queue.items)

  # Queues the item and schedules timer_msg to handle it once the lag passes. The due times never
  # go backwards, so the timers fire in queue order even if the lag is lowered. Each timer_msg
  # handles the oldest item, which is due no later than the timer that fired
  @spec delay(lag_queue(item), item, non_neg_integer(), atom()) :: lag_queue(item)
        when item: any()
  defp delay(lag_queue, item, lag_ms, timer_msg) do
    now = System.monotonic_time(:millisecond)
    due = max(now + lag_ms, lag_queue.last_due)
    _timer_ref = Process.send_after(self(), timer_msg, due - now)
    %{items: :queue.in(item, lag_queue.items), last_due: due}
  end

  @spec pop_lagged(lag_queue(item)) :: {item, lag_queue(item)} when item: any()
  defp pop_lagged(lag_queue) do
    {{:value, item}, items} = :queue.out(lag_queue.items)
    {item, %{lag_queue | items: items}}
  end

  # Server payloads

  defp build_message(payload) do
    {:binary, :erlang.term_to_binary({:msg, payload})}
  end

  defp build_reply(client_time) do
    server_time = GameTimer.time()
    {:binary, :erlang.term_to_binary({:reply, client_time, server_time})}
  end

  defp build_reply(client_time, payload) do
    server_time = GameTimer.time()
    {:binary, :erlang.term_to_binary({:reply, client_time, server_time, payload})}
  end
end
