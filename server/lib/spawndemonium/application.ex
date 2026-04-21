defmodule Spawndemonium.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    Spawndemonium.Utils.GameTimer.init()

    children = [
      SpawndemoniumWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:spawndemonium, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Spawndemonium.PubSub},
      {Spawndemonium.HighScores, name: Spawndemonium.HighScores},
      {Spawndemonium.GameLobby, name: Spawndemonium.GameLobby},
      # Start a worker by calling: Spawndemonium.Worker.start_link(arg)
      # {Spawndemonium.Worker, arg},
      # Start to serve requests, typically the last entry
      SpawndemoniumWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Spawndemonium.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    SpawndemoniumWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
