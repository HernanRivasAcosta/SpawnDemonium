defmodule Spawndemonium.Utils.GameTimer do
  require Logger

  @type tick_rate :: pos_integer()

  @spec init() :: :ok
  def init() do
    :ok = :persistent_term.put(:init_time, System.monotonic_time(:millisecond))
  end

  @spec time() :: integer()
  def time() do
    System.monotonic_time(:millisecond) - :persistent_term.get(:init_time)
  end

  @spec ms_per_tick(tick_rate()) :: pos_integer()
  def ms_per_tick(tick_rate) when rem(1000, tick_rate) == 0 do
    div(1000, tick_rate)
  end

  def ms_per_tick(tick_rate) do
    Logger.warning("bad tick rate: #{tick_rate}. Tick rates need to divide 1000 evenly")
    div(1000, tick_rate)
  end

  @spec tick_rate(pos_integer()) :: tick_rate()
  def tick_rate(ms) when is_integer(ms) and ms > 0 and ms <= 1000 do
    div(1000, ms)
  end
end
