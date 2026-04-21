defmodule Spawndemonium.GameHandler.WasmUtils do
  require Logger

  # Declare the type
  @type wasm_state :: %{
          pid: pid(),
          store: term(),
          memory: term()
        }

  @spec initialise(binary()) :: {:ok, wasm_state()}
  def initialise(bytes) do
    {:ok, wasm_pid} = Wasmex.start_link(%{bytes: bytes})
    {:ok, store} = Wasmex.store(wasm_pid)
    {:ok, memory} = Wasmex.memory(wasm_pid)

    {:ok, %{pid: wasm_pid, store: store, memory: memory}}
  end

  @spec write(non_neg_integer(), binary(), wasm_state()) :: :ok
  def write(pointer, bytes, state) do
    Wasmex.Memory.write_binary(state.store, state.memory, pointer, bytes)
  end

  @spec read(non_neg_integer(), non_neg_integer(), wasm_state()) :: binary()
  def read(pointer, num_bytes, state) do
    Wasmex.Memory.read_binary(state.store, state.memory, pointer, num_bytes)
  end
end
