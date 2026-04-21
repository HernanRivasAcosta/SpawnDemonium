import Config

config :spawndemonium, SpawndemoniumWeb.Endpoint,
  server: true,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

if config_env() == :prod do
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "environment variable SECRET_KEY_BASE is missing"

  config :spawndemonium, SpawndemoniumWeb.Endpoint,
    secret_key_base: secret_key_base,
    url: [host: System.get_env("PHX_HOST", "localhost")]

  config :spawndemonium, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")
end
