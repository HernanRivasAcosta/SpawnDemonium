defmodule Spawndemonium.LogFormatter do
  @spec format(Logger.level(), Logger.message(), term(), keyword()) ::
          IO.chardata()
  def format(level, message, _timestamp, metadata) do
    file = Keyword.get(metadata, :file, "unknown")
    line = Keyword.get(metadata, :line, "?")
    "[#{level}] [#{file}:#{line}] #{message}\n"
  rescue
    _ -> "[#{level}] #{message}\n"
  end
end
