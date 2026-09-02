import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameCanvas, type RacePhase, type Telemetry, type TouchInput } from "./game/GameCanvas";
import {
  ColyseusRaceNetwork,
  LocalDemoNetwork,
  type RaceConnectionState,
  type RaceNetworkAdapter,
} from "./network/raceNetwork";

const INITIAL_TELEMETRY: Telemetry = {
  speed: 0,
  rpm: 920,
  gear: 1,
  distance: 0,
  rivalDistance: 0,
  rivalGap: 0,
  elapsed: 0,
  nearMisses: 0,
  quality: "ULTRA",
  fps: 60,
  event: "SISTEMAS LISTOS",
};

const KM_TOTAL = 5;

const INITIAL_CONNECTION: RaceConnectionState = {
  status: "desconectado",
  roomCode: "",
  sessionId: "",
  phase: "waiting",
  countdownMs: 0,
  elapsedMs: 0,
  winnerSessionId: "",
  players: [],
  error: "",
};

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  const centiseconds = Math.floor((value % 1) * 100);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds
    .toString()
    .padStart(2, "0")}`;
}

export function App() {
  const onlineNetwork = useMemo(() => new ColyseusRaceNetwork(), []);
  const demoNetwork = useMemo(() => new LocalDemoNetwork(), []);
  const [network, setNetwork] = useState<RaceNetworkAdapter>(onlineNetwork);
  const [connection, setConnection] = useState(INITIAL_CONNECTION);
  const [displayName, setDisplayName] = useState("VÉRTICE");
  const [roomCode, setRoomCode] = useState("");
  const [phase, setPhase] = useState<RacePhase>("lobby");
  const [raceId, setRaceId] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [touch, setTouch] = useState<TouchInput>({ throttle: false, brake: false, steer: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const finishHandled = useRef(false);

  const startDemo = useCallback(async () => {
    onlineNetwork.disconnect();
    setConnection(INITIAL_CONNECTION);
    setNetwork(demoNetwork);
    await demoNetwork.connect?.("DEMO5K");
    finishHandled.current = false;
    setTelemetry(INITIAL_TELEMETRY);
    setRaceId((value) => value + 1);
    setCountdown(3);
    setPhase("countdown");
  }, [demoNetwork, onlineNetwork]);

  const createOnlineRoom = useCallback(async () => {
    setNetwork(onlineNetwork);
    setPhase("lobby");
    await onlineNetwork.createRoom(displayName);
  }, [displayName, onlineNetwork]);

  const joinOnlineRoom = useCallback(async () => {
    setNetwork(onlineNetwork);
    setPhase("lobby");
    await onlineNetwork.joinRoom(roomCode, displayName);
  }, [displayName, onlineNetwork, roomCode]);

  const returnToLobby = useCallback(() => {
    onlineNetwork.disconnect();
    setConnection(INITIAL_CONNECTION);
    setNetwork(onlineNetwork);
    setTelemetry(INITIAL_TELEMETRY);
    setPhase("lobby");
  }, [onlineNetwork]);

  useEffect(() => onlineNetwork.subscribeToState(setConnection), [onlineNetwork]);

  useEffect(() => {
    if (connection.phase === "countdown") {
      if (phase !== "countdown") {
        finishHandled.current = false;
        setTelemetry(INITIAL_TELEMETRY);
        setRaceId((value) => value + 1);
        setPhase("countdown");
      }
      setCountdown(Math.max(1, Math.ceil(connection.countdownMs / 1000)));
    } else if (connection.phase === "racing") {
      setCountdown(0);
      setPhase("race");
    } else if (connection.phase === "finished") {
      finishHandled.current = true;
      setPhase("result");
    }
  }, [connection.countdownMs, connection.phase, phase]);

  useEffect(() => {
    if (phase !== "countdown" || network.status !== "demo-local") return;
    const id = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(id);
          setPhase("race");
          return 0;
        }
        return current - 1;
      });
    }, 850);
    return () => window.clearInterval(id);
  }, [network, phase, raceId]);

  useEffect(() => {
    if (
      network.status === "demo-local" &&
      phase === "race" &&
      telemetry.distance >= 5000 &&
      !finishHandled.current
    ) {
      finishHandled.current = true;
      setPhase("result");
    }
  }, [network, phase, telemetry.distance]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      setPhase((current) => {
        if (current === "race") return "paused";
        if (current === "paused") return "race";
        return current;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setTouchPart = (part: Partial<TouchInput>) => {
    setTouch((current) => ({ ...current, ...part }));
  };

  const progress = Math.min(100, (telemetry.distance / 5000) * 100);
  const localPlayer = connection.players.find((player) => player.local);
  const rivalPlayer = connection.players.find((player) => !player.local);
  const playerWon =
    network.status === "demo-local"
      ? telemetry.distance >= telemetry.rivalDistance
      : connection.winnerSessionId === connection.sessionId;

  return (
    <main className={`app phase-${phase} ${reducedMotion ? "reduce-motion" : ""}`}>
      <GameCanvas
        key={raceId}
        phase={phase}
        touchInput={touch}
        reducedMotion={reducedMotion}
        soundEnabled={soundEnabled}
        network={network}
        onTelemetry={setTelemetry}
      />

      <div className="cinematic-bars" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <div className="wordmark" aria-label="Asphalt Rivals">
          <span className="wordmark-kicker">MOTO DUEL</span>
          <strong>ASPHALT / RIVALS</strong>
        </div>
        <div className="topbar-status">
          <span className="status-dot" />
          {network.status === "demo-local"
            ? "DEMO LOCAL"
            : connection.status === "conectado"
              ? `EN LÍNEA · ${connection.roomCode}`
              : connection.status.toUpperCase()}
          <span className="status-separator" />
          {telemetry.quality} · {telemetry.fps} FPS
        </div>
      </header>

      {phase === "lobby" && (
        <section className="lobby" aria-labelledby="lobby-title">
          <div className="lobby-copy">
            <p className="eyebrow">DUELO COSTERO // 5,0 KM</p>
            <h1 id="lobby-title">
              Domina el <em>asfalto</em>.
            </h1>
            <p className="lobby-lead">
              Dos motos. Una línea de llegada. El tráfico no se apartará por ti.
            </p>

            <div className="race-specs" aria-label="Condiciones de carrera">
              <div>
                <span>TRAZADO</span>
                <strong>VIADUCTO 07</strong>
              </div>
              <div>
                <span>CONDICIÓN</span>
                <strong>ASFALTO MOJADO</strong>
              </div>
              <div>
                <span>HORA</span>
                <strong>19:42 / OCASO</strong>
              </div>
            </div>

            <div className="online-panel">
              <label>
                <span>NOMBRE DE PILOTO</span>
                <input
                  value={displayName}
                  maxLength={20}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={connection.status === "conectado"}
                  aria-label="Nombre de piloto"
                />
              </label>
              <div className="join-row">
                <label>
                  <span>CÓDIGO DE SALA</span>
                  <input
                    value={roomCode}
                    maxLength={6}
                    placeholder="ABC234"
                    onChange={(event) =>
                      setRoomCode(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z2-9]/g, "")
                          .slice(0, 6),
                      )
                    }
                    disabled={connection.status === "conectado"}
                    aria-label="Código de sala"
                  />
                </label>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={joinOnlineRoom}
                  disabled={connection.status === "conectando" || roomCode.length !== 6}
                >
                  UNIRME
                </button>
              </div>
              <div className="lobby-actions">
                {connection.status === "conectado" ? (
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => onlineNetwork.setReady(!localPlayer?.ready)}
                  >
                    <span>{localPlayer?.ready ? "CANCELAR LISTO" : "ESTOY LISTO"}</span>
                    <small>
                      {connection.players.length < 2
                        ? "ESPERANDO AL SEGUNDO PILOTO"
                        : "LA CARRERA COMIENZA CUANDO AMBOS ESTÉN LISTOS"}
                    </small>
                  </button>
                ) : (
                  <button
                    className="primary-action"
                    type="button"
                    onClick={createOnlineRoom}
                    disabled={connection.status === "conectando"}
                  >
                    <span>
                      {connection.status === "conectando" ? "CONECTANDO…" : "CREAR SALA PRIVADA"}
                    </span>
                    <small>COMPARTE EL CÓDIGO CON TU RIVAL</small>
                  </button>
                )}
                <button className="text-action" type="button" onClick={startDemo}>
                  JUGAR DEMO LOCAL
                </button>
              </div>
              {connection.error && (
                <p className="connection-error" role="alert">
                  {connection.error}
                </p>
              )}
            </div>
          </div>

          <aside className="lobby-roster" aria-label="Pilotos en la sala">
            <div className="roster-heading">
              <span>{connection.status === "conectado" ? "SALA PRIVADA" : "DUELO ONLINE"}</span>
              <strong>{connection.roomCode || "SIN CONECTAR"}</strong>
            </div>
            {(connection.players.length
              ? connection.players
              : [
                  {
                    sessionId: "preview-local",
                    displayName: displayName.trim() || "VÉRTICE",
                    ready: false,
                    connected: true,
                    local: true,
                  },
                ]
            ).map((player, index) => (
              <article
                className={`rider-card ${player.local ? "rider-you" : "rider-rival"}`}
                key={player.sessionId}
              >
                <span className="rider-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{player.local ? "TÚ" : "RIVAL ONLINE"}</small>
                  <strong>{player.displayName.toUpperCase()}</strong>
                  <span>{player.local ? "AX-9 / CIAN" : "R-12 / CORAL"}</span>
                </div>
                <i>{!player.connected ? "RECONECTANDO" : player.ready ? "LISTO" : "EN ESPERA"}</i>
              </article>
            ))}
            {connection.players.length < 2 && (
              <article className="rider-card rider-rival rider-empty">
                <span className="rider-index">02</span>
                <div>
                  <small>RIVAL</small>
                  <strong>ESPERANDO…</strong>
                  <span>COMPARTE EL CÓDIGO DE SALA</span>
                </div>
                <i>LIBRE</i>
              </article>
            )}
            <p className="demo-note">
              {connection.status === "conectado"
                ? "Servidor autoritativo activo · carrera sincronizada de 5,0 km."
                : "Crea una sala o introduce un código de seis caracteres para competir online."}
            </p>
          </aside>
        </section>
      )}

      {(phase === "countdown" || phase === "race" || phase === "paused") && (
        <section className="race-hud" aria-label="Información de carrera">
          <div className="hud-left">
            <div className="weather-chip">
              <span>LLUVIA</span>
              <strong>TRACCIÓN 82%</strong>
            </div>
            <div className="event-feed" key={telemetry.event}>
              {telemetry.event}
            </div>
          </div>

          <div className="race-progress">
            <div className="progress-labels">
              <span>VÉRTICE</span>
              <strong>
                {(telemetry.distance / 1000).toFixed(2)} / {KM_TOTAL.toFixed(1)} KM
              </strong>
              <span>NOVA</span>
            </div>
            <div className="progress-track">
              <i style={{ width: `${progress}%` }} />
              <b style={{ left: `${Math.min(99, (telemetry.rivalDistance / 5000) * 100)}%` }} />
            </div>
            <div className={`gap ${telemetry.rivalGap >= 0 ? "ahead" : "behind"}`}>
              {telemetry.rivalGap >= 0 ? "VENTAJA" : "DÉFICIT"}{" "}
              {Math.abs(telemetry.rivalGap).toFixed(1)} M
            </div>
          </div>

          <div className="hud-right">
            <span>TIEMPO</span>
            <strong>{formatTime(telemetry.elapsed)}</strong>
          </div>

          <div className="speed-cluster">
            <div className="gear">
              <span>MARCHA</span>
              <strong>{telemetry.gear}</strong>
            </div>
            <div className="speed">
              <strong>{Math.round(telemetry.speed)}</strong>
              <span>KM/H</span>
            </div>
            <div className="rpm-track">
              <i style={{ width: `${Math.min(100, telemetry.rpm / 110)}%` }} />
            </div>
            <small>
              {Math.round(telemetry.rpm)} RPM · {telemetry.nearMisses} AL LÍMITE
            </small>
          </div>
        </section>
      )}

      {phase === "countdown" && (
        <div className="countdown" aria-live="assertive">
          <span>SISTEMAS SINCRONIZADOS</span>
          <strong key={countdown}>{countdown || "¡YA!"}</strong>
          <i />
        </div>
      )}

      {phase === "paused" && (
        <section className="pause-panel" aria-label="Carrera en pausa">
          <p className="eyebrow">TELEMETRÍA EN ESPERA</p>
          <h2>PAUSA</h2>
          <button type="button" className="primary-action" onClick={() => setPhase("race")}>
            VOLVER A LA PISTA
          </button>
          <button type="button" className="text-action" onClick={returnToLobby}>
            ABANDONAR DUELO
          </button>
        </section>
      )}

      {(phase === "race" || phase === "countdown") && (
        <div className="touch-controls" aria-label="Controles táctiles">
          <div className="touch-steer">
            <button
              type="button"
              aria-label="Girar a la izquierda"
              onPointerDown={() => setTouchPart({ steer: -1 })}
              onPointerUp={() => setTouchPart({ steer: 0 })}
              onPointerCancel={() => setTouchPart({ steer: 0 })}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Girar a la derecha"
              onPointerDown={() => setTouchPart({ steer: 1 })}
              onPointerUp={() => setTouchPart({ steer: 0 })}
              onPointerCancel={() => setTouchPart({ steer: 0 })}
            >
              ›
            </button>
          </div>
          <div className="touch-pedals">
            <button
              type="button"
              className="brake-touch"
              onPointerDown={() => setTouchPart({ brake: true })}
              onPointerUp={() => setTouchPart({ brake: false })}
              onPointerCancel={() => setTouchPart({ brake: false })}
            >
              FRENO
            </button>
            <button
              type="button"
              className="throttle-touch"
              onPointerDown={() => setTouchPart({ throttle: true })}
              onPointerUp={() => setTouchPart({ throttle: false })}
              onPointerCancel={() => setTouchPart({ throttle: false })}
            >
              GAS
            </button>
          </div>
        </div>
      )}

      {phase === "result" && (
        <section className="result-panel" aria-labelledby="result-title">
          <p className="eyebrow">CLASIFICACIÓN // VIADUCTO 07</p>
          <h2 id="result-title">{playerWon ? "VICTORIA" : "SEGUNDO PUESTO"}</h2>
          <p>
            {playerWon
              ? "Le ganaste al ocaso."
              : `${rivalPlayer?.displayName || "Nova"} encontró el hueco primero.`}
          </p>
          <div className="result-time">
            {formatTime(
              network.status === "demo-local" ? telemetry.elapsed : connection.elapsedMs / 1000,
            )}
          </div>
          <div className="result-grid">
            <div>
              <span>VELOCIDAD PUNTA</span>
              <strong>{Math.round(Math.max(telemetry.speed, 286))} KM/H</strong>
            </div>
            <div>
              <span>ADELANTAMIENTOS AL LÍMITE</span>
              <strong>{telemetry.nearMisses}</strong>
            </div>
            <div>
              <span>DIFERENCIA FINAL</span>
              <strong>{Math.abs(telemetry.rivalGap).toFixed(2)} M</strong>
            </div>
          </div>
          <div className="result-actions">
            <button type="button" className="primary-action" onClick={() => setPhase("replay")}>
              VER REPETICIÓN
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={network.status === "demo-local" ? startDemo : returnToLobby}
            >
              NUEVA CARRERA
            </button>
          </div>
        </section>
      )}

      {phase === "replay" && (
        <div className="replay-banner">
          <div>
            <span>REPETICIÓN CINEMATOGRÁFICA</span>
            <strong>VIADUCTO 07 / CÁMARA 03</strong>
          </div>
          <button type="button" onClick={() => setPhase("result")}>
            SALIR
          </button>
        </div>
      )}

      <aside className="settings-dock" aria-label="Preferencias">
        <button
          type="button"
          aria-pressed={soundEnabled}
          onClick={() => setSoundEnabled((value) => !value)}
        >
          AUDIO {soundEnabled ? "ACTIVO" : "MUDO"}
        </button>
        <button
          type="button"
          aria-pressed={reducedMotion}
          onClick={() => setReducedMotion((value) => !value)}
        >
          MOVIMIENTO {reducedMotion ? "REDUCIDO" : "CINEMÁTICO"}
        </button>
      </aside>
    </main>
  );
}
