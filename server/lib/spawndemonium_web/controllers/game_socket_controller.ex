defmodule SpawndemoniumWeb.GameSocketController do
  use SpawndemoniumWeb, :controller

  @spec upgrade(Plug.Conn.t(), map()) :: Plug.Conn.t()
  def upgrade(conn, _params) do
    WebSockAdapter.upgrade(conn, SpawndemoniumWeb.GameSocket, %{}, compress: true)
  end
end
