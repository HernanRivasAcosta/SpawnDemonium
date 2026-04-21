import type Game from "../game.ts";
import Node from "../core/node.ts";
import NetClock from "./clock.ts";
import { Tuple, ETF } from "./etf.ts";

const enum ConnectionState {
  DISCONNECTED,
  CONNECTED,
  SYNCED,
  IN_GAME,
}

export interface ConnectionListener {
  // Fired when the connection to the server is established
  onConnection(): void;
  // Fired when the clocks are synced and the connection is ready to send game messages
  onSynced(): void;
  // Fired when the client has joined a game
  onGameJoined(
    playerId: number,
    players: Map<number, Uint8Array>,
    state: Map<symbol, unknown>,
  ): void;
  // Fired when a message is received, anything returned by this function is sent to the server
  onMessage(payload: unknown): unknown | null;
  // Fired when the connection to the server is lost (or when it was unable to be established)
  onDisconnected(): void;
}

class ServerConnection extends Node {
  #listener: ConnectionListener | null;
  #etf: ETF;
  #ws: WebSocket | null;
  #clock: NetClock;
  get clock(): NetClock {
    return this.#clock;
  }
  // The current connection state
  #state: ConnectionState;
  get state(): ConnectionState {
    return this.#state;
  }
  get connected(): boolean {
    return this.#state !== ConnectionState.DISCONNECTED;
  }
  get synced(): boolean {
    return (
      this.#state === ConnectionState.SYNCED ||
      this.#state === ConnectionState.IN_GAME
    );
  }
  get inGame(): boolean {
    return this.#state === ConnectionState.IN_GAME;
  }
  // The interval at which to send heartbeats, in milliseconds
  #heartbeat: number;
  // The timestamp of the last message sent
  #lastMessage: number;

  constructor(game: Game, listener: ConnectionListener | null = null) {
    super(game);
    this.#listener = listener;
    // Instanciate the erlang/elixir term parser and websocket
    const jemProps = ETF.BINARIES_AS_UINT8_ARRAYS | ETF.NULL_AS_NIL;
    this.#etf = new ETF(jemProps);
    this.#ws = null;
    // Set the connection state
    this.#state = ConnectionState.DISCONNECTED;
    this.#clock = new NetClock();
    this.#heartbeat = 10000;
    this.#lastMessage = -1;
  }

  connect(
    path: string = "ws",
    protocol: string | null = null,
    host: string | null = null,
  ): void {
    protocol =
      protocol || (window.location.protocol === "https:" ? "wss" : "ws");
    const url = `${protocol}://${host || window.location.host}/${path}`;
    console.info(`Opening websocket connection to ${url}`);
    this.#ws = new WebSocket(url);
    this.#ws.binaryType = "arraybuffer";
    this.#ws.onopen = this.#onWSOpened;
    this.#ws.onclose = this.#onWSClosed;
    this.#ws.onmessage = this.#onWSMessage;
    // We don't need to handle onerror, since onclosed will be called afterwards anyway
  }

  send(payload: unknown): void {
    const msg = new Tuple(Symbol.for("req"), this.#clock.localTime, payload);
    this.#ws!.send(this.#etf.encode(msg));
    this.#lastMessage = performance.now();
  }

  // The listener is notified like with any other disconnection, unless skipEvents is set
  disconnect(skipEvents: boolean = false): void {
    if (this.#ws !== null) {
      if (skipEvents) {
        this.#ws.onopen = null;
        this.#ws.onclose = null;
        this.#ws.onmessage = null;
        // The close handler won't run, so it can't update the state
        this.#state = ConnectionState.DISCONNECTED;
      }
      this.#ws.close();
      this.#ws = null;
    }
  }

  changeListener(newListener: ConnectionListener | null): void {
    this.#listener = newListener;
  }

  sendPing(): void {
    this.send(Symbol.for("ping"));
  }

  tick(tick: number) {
    super.tick(tick);
    // Send a ping to make sure we are not disconnected
    if (this.#state !== ConnectionState.DISCONNECTED) {
      const td = performance.now() - this.#lastMessage;
      if (td > this.#heartbeat) {
        this.sendPing();
      }
    }
  }

  // Arrow function fields so they can be assigned directly to ws.onopen etc.
  #onWSOpened = (): void => {
    console.info(`Websocket opened`);
    if (this.#listener) this.#listener.onConnection();
    else console.warn("Unable to call onConnection on", this.#listener);
    this.send(Symbol.for("connection_request"));
  };

  #onWSMessage = (e: MessageEvent): void => {
    const rawMsg = e.data as ArrayBuffer;
    const decodedMsg = this.#etf.decode(rawMsg) as unknown[];
    const header = decodedMsg[0];
    if (header === Symbol.for("reply")) {
      // All replies contain both an echo of the clientTime and the server time
      const clientTime = decodedMsg[1] as number;
      const serverTime = decodedMsg[2] as number;
      // Add the sample to the clock
      this.#clock.addSample(clientTime, serverTime);
      // If the clocks are synced, make sure we are in the correct state
      if (this.#clock.synced) {
        if (this.#state === ConnectionState.CONNECTED) {
          this.#state = ConnectionState.SYNCED;
          if (this.#listener) this.#listener.onSynced();
          else console.warn("Unable to call onSynced on", this.#listener);
        }
      } else {
        this.sendPing();
      }
      // Regardless of the syncing, if there's a payload we need to handle it
      if (decodedMsg.length === 4) {
        this.#handlePayload(decodedMsg[3]);
      }
    } else {
      this.#handlePayload(decodedMsg[1]);
    }
  };

  #handlePayload(payload: unknown): void {
    const [payloadType, payloadData] = payload as [
      symbol,
      Map<symbol, unknown>,
    ];
    // We can't use switch with atoms...
    if (payloadType === Symbol.for("connected")) {
      const config = payloadData.get(Symbol.for("config")) as Map<
        symbol,
        unknown
      >;
      this.#state = ConnectionState.CONNECTED;
      console.info("Connected to server");
      this.#heartbeat = Math.floor(
        (config.get(Symbol.for("timeout")) as number) / 3,
      );
      console.debug(`Sending heartbeat every ${this.#heartbeat}ms`);
      // Send the first ping
      this.sendPing();
    } else if (payloadType === Symbol.for("joined")) {
      this.#state = ConnectionState.IN_GAME;
      const playerId = payloadData.get(Symbol.for("player_id")) as number;
      const players = payloadData.get(Symbol.for("players")) as Map<
        number,
        Uint8Array
      >;
      const current_state = payloadData.get(Symbol.for("state")) as Map<
        symbol,
        unknown
      >;
      // TODO: Store the current time
      //const current_time = msg.get(Symbol.for('current_time'));
      if (this.#listener)
        this.#listener.onGameJoined(playerId, players, current_state);
      else console.warn("Unable to call onGameJoined on", this.#listener);
    } else {
      if (this.#listener) {
        const response = this.#listener.onMessage(payload);
        if (response) this.send(response);
      }
    }
  }

  #onWSClosed = (): void => {
    console.error(`Websocket disconnected`);
    this.#state = ConnectionState.DISCONNECTED;
    this.#ws = null;
    if (this.#listener) this.#listener.onDisconnected();
    else console.warn("Unable to call onDisconnected on", this.#listener);
  };

  remove() {
    super.remove();
    // The close event arrives after the listener (usually a screen) is gone
    this.disconnect(true);
  }
}

export default ServerConnection;
