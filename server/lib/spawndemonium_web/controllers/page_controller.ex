defmodule SpawndemoniumWeb.PageController do
  use SpawndemoniumWeb, :controller

  def home(conn, _params) do
    path = Application.app_dir(:spawndemonium, "priv/static/index.html")

    conn
    |> put_resp_content_type("text/html")
    |> send_file(200, path)
  end
end
