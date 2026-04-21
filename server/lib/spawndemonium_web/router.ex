defmodule SpawndemoniumWeb.Router do
  use SpawndemoniumWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :put_secure_browser_headers
  end

  scope "/", SpawndemoniumWeb do
    pipe_through :browser

    get "/", PageController, :home
    get "/ws", GameSocketController, :upgrade
  end

  if Application.compile_env(:spawndemonium, :dev_routes) do
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: SpawndemoniumWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
