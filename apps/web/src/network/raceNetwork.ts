export type RaceInput = {
  throttle: number;
  brake: number;
  steer: number;
  timestamp: number;
};

export type RivalSnapshot = {
  distance: number;
  laneOffset: number;
  speed: number;
  timestamp: number;
};

export type NetworkStatus = 'desconectado' | 'conectando' | 'conectado' | 'demo-local';

export interface RaceNetworkAdapter {
  readonly status: NetworkStatus;
  connect(roomCode: string): Promise<void>;
  sendInput(input: RaceInput): void;
  subscribeToRival(listener: (snapshot: RivalSnapshot) => void): () => void;
  disconnect(): void;
}

/**
 * Capa de integración intencionalmente pequeña. El cliente visual funciona sin
 * servidor y un adaptador WebSocket/WebRTC puede sustituir esta clase sin tocar
 * la escena, el HUD ni los controles.
 */
export class LocalDemoNetwork implements RaceNetworkAdapter {
  readonly status = 'demo-local' as const;

  async connect(_roomCode: string) {
    await Promise.resolve();
  }

  sendInput(_input: RaceInput) {}

  subscribeToRival(_listener: (snapshot: RivalSnapshot) => void) {
    return () => undefined;
  }

  disconnect() {}
}
