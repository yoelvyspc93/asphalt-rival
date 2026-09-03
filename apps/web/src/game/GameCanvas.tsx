import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { drawGauge } from "./models/cockpit";
import {
  createMotorcycle,
  getLoadedMotorcycleTemplate,
  loadMotorcycleTemplate,
} from "./models/motorcycle";
import { createTrafficVehicle, animateVehicleWheels } from "./models/roadVehicles";
import { createOvercastSky, createDryAsphaltMaterial } from "./overcastEnvironment";
import {
  createCliffSegment,
  createCoastalGantry,
  createCoastalMaterials,
  createCoastalOcean,
  updateCoastalOcean,
  type CoastalMaterials,
} from "./coastalEnvironment";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  ARCADE_LANE_CENTERS,
  arcadeTrafficLateralPosition,
  applyArcadeTrafficCollisions,
  generateTraffic,
  type TrafficVehicleState,
} from "@game-moto/simulation";
import type { RaceNetworkAdapter } from "../network/raceNetwork";

export type RacePhase = "lobby" | "countdown" | "race" | "paused" | "result" | "replay";

export type TouchInput = {
  throttle: boolean;
  brake: boolean;
  steer: -1 | 0 | 1 | number;
};

export type Telemetry = {
  speed: number;
  rpm: number;
  gear: number;
  distance: number;
  rivalDistance: number;
  rivalGap: number;
  elapsed: number;
  nearMisses: number;
  quality: "ULTRA" | "ALTA" | "DINÁMICA";
  fps: number;
  event: string;
};

type GameCanvasProps = {
  phase: RacePhase;
  touchInput: TouchInput;
  reducedMotion: boolean;
  soundEnabled: boolean;
  network: RaceNetworkAdapter;
  onTelemetry: (telemetry: Telemetry) => void;
  onAssetsReady: (ready: boolean) => void;
};

type TrafficVehicle = {
  group: THREE.Group;
  trafficId: string | null;
  models: Map<TrafficVehicleState["kind"], THREE.Group>;
};

const lanes = ARCADE_LANE_CENTERS;

const SAME_STATION_Z = 6.15;
const VIEW_AHEAD_METERS = 170;
const VIEW_BEHIND_METERS = 14;
const events = ["REBUFO ACTIVO", "TRACCIÓN ESTABLE", "VIENTO LATERAL", "NOVA EN RADAR"];

function worldZFromGap(gapAheadMeters: number) {
  return SAME_STATION_Z - gapAheadMeters;
}

function mat(color: number, roughness = 0.45, metalness = 0.15, emissive = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity: emissive ? 0.35 : 0,
  });
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  castShadow = true,
) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.castShadow = castShadow;
  object.receiveShadow = true;
  return object;
}

function createRoadSegment(
  index: number,
  asphalt: THREE.MeshStandardMaterial,
  coastal: CoastalMaterials,
) {
  const group = new THREE.Group();
  group.position.z = 35 - index * 72;

  group.add(mesh(new THREE.BoxGeometry(15.2, 0.22, 72), asphalt, [0, -0.11, 0], false));
  group.add(mesh(new THREE.BoxGeometry(1.0, 0.25, 72), coastal.shoulder, [-8.08, -0.17, 0], false));
  group.add(mesh(new THREE.BoxGeometry(1.0, 0.25, 72), coastal.shoulder, [8.08, -0.17, 0], false));
  group.add(mesh(new THREE.BoxGeometry(0.72, 1.18, 72), coastal.barrier, [-8.62, 0.38, 0]));
  group.add(mesh(new THREE.BoxGeometry(0.82, 2.5, 72), coastal.retainingWall, [8.66, 1.03, 0]));
  for (const x of [-3.1, 0, 3.1]) {
    for (let z = -30; z <= 30; z += 12) {
      group.add(
        mesh(new THREE.BoxGeometry(0.12, 0.003, 5.4), coastal.lanePaint, [x, 0.002, z], false),
      );
    }
  }
  group.add(
    mesh(
      new THREE.BoxGeometry(2.25, 0.006, 4.8),
      coastal.asphaltRepair,
      [index % 2 === 0 ? -4.65 : 1.55, 0.004, -17 + (index % 3) * 9],
      false,
    ),
  );
  group.add(
    mesh(new THREE.BoxGeometry(15.1, 0.004, 0.055), coastal.asphaltRepair, [0, 0.003, -35], false),
  );

  for (const x of [-8.55, 8.55]) {
    group.add(mesh(new THREE.BoxGeometry(0.16, 0.22, 72), coastal.rail, [x, 0.52, 0], false));
    for (let z = -30; z < 34; z += 8) {
      group.add(mesh(new THREE.BoxGeometry(0.12, 0.84, 0.12), coastal.rail, [x, 0.2, z], false));
    }
  }

  if (index % 2 === 0) {
    for (const x of [-10.2, 10.2]) {
      group.add(mesh(new THREE.CylinderGeometry(0.08, 0.13, 7, 8), coastal.lamp, [x, 3.4, -8]));
      group.add(
        mesh(
          new THREE.BoxGeometry(1.1, 0.12, 0.32),
          coastal.lampGlow,
          [x + (x < 0 ? 0.45 : -0.45), 6.82, -8],
          false,
        ),
      );
    }
  }

  group.add(createCliffSegment(index, coastal));
  if (index % 5 === 2) {
    const gantry = createCoastalGantry(coastal);
    gantry.position.z = -18;
    group.add(gantry);
  }

  return group;
}

function createTunnelSegment(index: number) {
  const group = new THREE.Group();
  group.position.z = 30 - index * 22;
  const concrete = mat(0x242c2d, 0.72, 0.16);
  const tunnelAsphalt = mat(0x343b3e, 0.96, 0);
  const light = mat(0xffa94f, 0.2, 0.2, 0xff861f);
  group.add(mesh(new THREE.BoxGeometry(1.2, 6.7, 21), concrete, [-8.5, 3.15, 0]));
  group.add(mesh(new THREE.BoxGeometry(1.2, 6.7, 21), concrete, [8.5, 3.15, 0]));
  group.add(mesh(new THREE.BoxGeometry(18.2, 0.7, 21), concrete, [0, 6.35, 0]));
  group.add(mesh(new THREE.BoxGeometry(15.3, 0.03, 21), tunnelAsphalt, [0, -0.02, 0], false));
  if (index % 2 === 0) {
    group.add(mesh(new THREE.BoxGeometry(5.8, 0.12, 0.28), light, [-4.2, 5.92, -6], false));
    group.add(mesh(new THREE.BoxGeometry(5.8, 0.12, 0.28), light, [4.2, 5.92, -6], false));
  }
  return group;
}

function createEngineAudio() {
  let context: AudioContext | null = null;
  let engine: OscillatorNode | null = null;
  let harmonic: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let active = false;

  const ensure = () => {
    if (context) {
      void context.resume();
      return;
    }
    context = new AudioContext();
    gain = context.createGain();
    gain.gain.value = 0;
    filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 780;
    engine = context.createOscillator();
    engine.type = "sawtooth";
    harmonic = context.createOscillator();
    harmonic.type = "triangle";
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.24;
    engine.connect(filter);
    harmonic.connect(harmonicGain).connect(filter);
    filter.connect(gain).connect(context.destination);
    engine.start();
    harmonic.start();
    active = true;
  };

  const update = (rpm: number, speed: number, enabled: boolean) => {
    if (!context || !engine || !harmonic || !gain || !filter || !active) return;
    const now = context.currentTime;
    const base = 42 + rpm * 0.017;
    engine.frequency.setTargetAtTime(base, now, 0.035);
    harmonic.frequency.setTargetAtTime(base * 2.03, now, 0.045);
    filter.frequency.setTargetAtTime(520 + speed * 7.8, now, 0.09);
    gain.gain.setTargetAtTime(enabled ? Math.min(0.085, 0.022 + speed / 4400) : 0, now, 0.08);
  };

  const dispose = () => {
    active = false;
    engine?.stop();
    harmonic?.stop();
    void context?.close();
  };

  return { ensure, update, dispose };
}

export function GameCanvas(props: GameCanvasProps) {
  const [template, setTemplate] = useState(getLoadedMotorcycleTemplate);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { onAssetsReady } = props;
  useEffect(() => {
    let active = true;
    onAssetsReady(Boolean(getLoadedMotorcycleTemplate()));
    setFailed(false);
    void loadMotorcycleTemplate().then(
      (model) => {
        if (!active) return;
        setTemplate(model);
        onAssetsReady(true);
      },
      (error: unknown) => {
        if (!active) return;
        console.error("No se pudo cargar la Suzuki", error);
        setFailed(true);
        onAssetsReady(false);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, onAssetsReady]);

  if (template) return <GameScene {...props} template={template} />;
  return (
    <div className="model-loading" role={failed ? "alert" : "status"}>
      <span className="model-loading-label">ASPHALT RIVALS / GARAJE</span>
      <h2>{failed ? "No se pudo cargar la Suzuki" : "Preparando tu Suzuki"}</h2>
      <p>
        {failed
          ? "Comprueba la conexión y vuelve a intentarlo."
          : "Cargando el modelo 3D, los materiales y las ruedas…"}
      </p>
      {failed && (
        <button
          className="primary-action"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          REINTENTAR
        </button>
      )}
    </div>
  );
}

function GameScene({
  phase,
  touchInput,
  reducedMotion,
  soundEnabled,
  network,
  onTelemetry,
  template,
}: GameCanvasProps & { template: THREE.Group }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const touchRef = useRef(touchInput);
  const reducedMotionRef = useRef(reducedMotion);
  const soundRef = useRef(soundEnabled);
  const telemetryRef = useRef(onTelemetry);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    touchRef.current = touchInput;
  }, [touchInput]);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);
  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => {
    telemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x738690, 0.0028);
    const sky = createOvercastSky();
    scene.add(sky);
    // The same cloud dome lights the models; no distorted 2D environment map.
    const environmentScene = new THREE.Scene();
    environmentScene.add(sky.clone());
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmrem.fromScene(environmentScene, 0.04, 0.1, 1000);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();
    environmentScene.clear();

    const camera = new THREE.PerspectiveCamera(72, host.clientWidth / host.clientHeight, 0.05, 900);
    camera.position.set(0, 1.55, 6.5);
    scene.add(camera);

    const composer = new EffectComposer(renderer);
    composer.setSize(host.clientWidth, host.clientHeight);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(host.clientWidth, host.clientHeight),
      0.15,
      0.35,
      1.15,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const skylight = new THREE.HemisphereLight(0xc4d3dc, 0x465050, 2);
    scene.add(skylight);
    const sunLight = new THREE.DirectionalLight(0xdbe7ee, 1.65);
    sunLight.position.set(-34, 48, 15);
    sunLight.castShadow = true;
    sunLight.shadow.radius = 4;
    sunLight.shadow.normalBias = 0.035;
    sunLight.shadow.bias = -0.00015;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -28;
    sunLight.shadow.camera.right = 28;
    sunLight.shadow.camera.top = 24;
    sunLight.shadow.camera.bottom = -8;
    sunLight.shadow.camera.far = 140;
    scene.add(sunLight);

    const fill = new THREE.DirectionalLight(0xc9a08b, 0.35);
    fill.position.set(18, 12, -30);
    scene.add(fill);

    const ambient = new THREE.AmbientLight(0xb8c2c6, 0.22);
    scene.add(ambient);
    const ocean = createCoastalOcean();
    scene.add(ocean);

    const asphalt = createDryAsphaltMaterial(renderer.capabilities.getMaxAnisotropy());
    const coastalMaterials = createCoastalMaterials(renderer.capabilities.getMaxAnisotropy());
    const roadSegments = Array.from({ length: 16 }, (_, index) =>
      createRoadSegment(index, asphalt, coastalMaterials),
    );
    roadSegments.forEach((segment) => scene.add(segment));

    const tunnel = new THREE.Group();
    const tunnelSegments = Array.from({ length: 10 }, (_, index) => createTunnelSegment(index));
    tunnelSegments.forEach((segment) => tunnel.add(segment));
    tunnel.visible = false;
    scene.add(tunnel);

    const tunnelLightA = new THREE.PointLight(0xff962f, 17, 62, 1.7);
    tunnelLightA.position.set(-4, 5.2, -28);
    const tunnelLightB = tunnelLightA.clone();
    tunnelLightB.position.set(4, 5.2, -88);
    tunnel.add(tunnelLightA, tunnelLightB);

    const playerMotorcycle = createMotorcycle(0xb82636, 0xe55660, template);
    const rivalMotorcycle = createMotorcycle(0x2467a8, 0x7cbeef, template);
    const playerBike = playerMotorcycle.group;
    const playerRider = playerBike.getObjectByName("rider");
    const playerHands = playerMotorcycle.firstPersonHands;
    const rival = rivalMotorcycle.group;
    rivalMotorcycle.firstPersonHands.visible = false;
    playerBike.position.set(0, 0, SAME_STATION_Z);
    rival.position.set(1.55, 0, -28);
    scene.add(playerBike, rival);

    const TRAFFIC_POOL = 28;
    let trafficSeed = 42;
    let trafficField: TrafficVehicleState[] = generateTraffic(trafficSeed);
    const traffic: TrafficVehicle[] = Array.from({ length: TRAFFIC_POOL }, () => {
      const group = new THREE.Group();
      group.visible = false;
      scene.add(group);
      return { group, trafficId: null, models: new Map() };
    });

    const rebuildTraffic = (seed: number) => {
      const next = seed || 42;
      if (next === trafficSeed && trafficField.length > 0) return;
      trafficSeed = next;
      trafficField = generateTraffic(trafficSeed);
      traffic.forEach((slot) => {
        slot.trafficId = null;
        slot.group.visible = false;
      });
    };

    const keys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      keys.add(event.code);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code))
        event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const clearKeys = () => keys.clear();
    window.addEventListener("blur", clearKeys);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);

    const audio = createEngineAudio();
    const enableAudio = () => audio.ensure();
    window.addEventListener("pointerdown", enableAudio, { once: true });
    window.addEventListener("keydown", enableAudio, { once: true });

    let speed = 0;
    let rpm = 920;
    let gear = 1;
    let distance = 0;
    let rivalDistance = 0;
    let rivalSpeed = 0;
    let networkRivalLane: number | null = null;
    let networkLocal: {
      distance: number;
      laneOffset: number;
      speed: number;
      elapsed: number;
    } | null = null;
    let playerX = 0;
    let steering = 0;
    let previewDistance = 0;
    let previewElapsed = 0;
    let elapsed = 0;
    let replayTime = 0;
    let nearMisses = 0;
    let eventText = "SISTEMAS LISTOS";
    let eventTimer = 0;
    let telemetryTimer = 0;
    let qualityIndex = 2;
    let qualityLabel: Telemetry["quality"] = "ULTRA";
    let fps = 60;
    let frameAccumulator = 0;
    let frameCount = 0;
    let qualityTimer = 0;
    let stableTimer = 0;
    let priorPhase = phaseRef.current;
    const trafficCooldowns = new Map<string, number>();
    const riderBody = {
      speed: 0,
      lateralPosition: 0,
      lean: 0,
      distance: 0,
      hitstunMs: 0,
    };
    const clock = new THREE.Clock();
    const visualReviewMode = new URLSearchParams(window.location.search).has("visual-review");
    let animationFrame = 0;
    const unsubscribeRival = network.subscribeToRival((snapshot) => {
      rivalDistance = snapshot.distance;
      rivalSpeed = snapshot.speed;
      networkRivalLane = snapshot.laneOffset;
    });
    const unsubscribeSimulation = network.subscribeToSimulation?.((frame) => {
      if (frame.seed) rebuildTraffic(frame.seed);
      if (frame.local) {
        networkLocal = {
          distance: frame.local.distance,
          laneOffset: frame.local.laneOffset,
          speed: frame.local.speed,
          elapsed: frame.elapsedMs / 1000,
        };
      }
      if (frame.rival) {
        rivalDistance = frame.rival.distance;
        rivalSpeed = frame.rival.speed;
        networkRivalLane = frame.rival.laneOffset;
      }
    });
    const unsubscribeState = network.subscribeToState?.((state) => {
      if (state.seed) rebuildTraffic(state.seed);
    });

    const applyQuality = () => {
      const ratios = [0.85, 1.2, 1.65];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratios[qualityIndex]));
      composer.setPixelRatio(Math.min(window.devicePixelRatio, ratios[qualityIndex]));
      sunLight.shadow.mapSize.set(
        qualityIndex === 2 ? 2048 : 1024,
        qualityIndex === 2 ? 2048 : 1024,
      );
      qualityLabel = qualityIndex === 2 ? "ULTRA" : qualityIndex === 1 ? "ALTA" : "DINÁMICA";
    };

    const triggerEvent = (message: string, duration = 1.65) => {
      eventText = message;
      eventTimer = duration;
    };

    const onResize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener("resize", onResize);

    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      const frameDelta = clock.getDelta();
      const dt = Math.min(frameDelta, visualReviewMode ? 0.5 : 0.05);
      const activePhase = phaseRef.current;
      const isRace = activePhase === "race";
      const isReplay = activePhase === "replay";
      const isLobby = activePhase === "lobby";
      const isPaused = activePhase === "paused" || activePhase === "result";

      if (activePhase !== priorPhase) {
        if (activePhase === "replay") replayTime = 0;
        if (
          activePhase === "race" &&
          network.status === "demo-local" &&
          Math.abs(rivalDistance - distance) < 3
        ) {
          rivalDistance = distance + 18;
          rivalSpeed = visualReviewMode ? 220 : 35;
          if (visualReviewMode) speed = 220;
        }
        priorPhase = activePhase;
      }

      const keyboardSteer =
        (keys.has("KeyA") || keys.has("ArrowLeft") ? -1 : 0) +
        (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
      const targetSteer = isRace
        ? THREE.MathUtils.clamp(keyboardSteer || touchRef.current.steer, -1, 1)
        : 0;
      steering = THREE.MathUtils.lerp(steering, targetSteer, 1 - Math.exp(-dt * 10));
      const steer = steering;
      const throttlePressed = keys.has("KeyW") || keys.has("ArrowUp") || touchRef.current.throttle;
      const brakePressed = keys.has("KeyS") || keys.has("ArrowDown") || touchRef.current.brake;

      if (isRace || activePhase === "countdown") {
        network.sendInput({
          throttle: throttlePressed ? 1 : 0,
          brake: brakePressed ? 1 : 0,
          steer,
          timestamp: performance.now(),
        });
      }

      if (isRace) {
        const throttle = brakePressed ? 0 : throttlePressed ? 1 : 0.42;
        const networked = network.status === "conectado";
        const stunned = riderBody.hitstunMs > 0;
        if (stunned) riderBody.hitstunMs = Math.max(0, riderBody.hitstunMs - dt * 1000);

        if (networked && networkLocal) {
          const follow = 1 - Math.exp(-dt * 14);
          if (networkLocal.speed < speed - 8) speed = networkLocal.speed;
          else speed = THREE.MathUtils.lerp(speed, networkLocal.speed, follow);
          distance = networkLocal.distance;
          playerX = THREE.MathUtils.lerp(playerX, networkLocal.laneOffset, follow);
          elapsed = networkLocal.elapsed;
        } else if (!networked) {
          const drive = stunned ? 0 : throttle;
          const drag = 0.000032 * speed * speed + 0.55;
          // km/h/s. Full braking from 300 km/h now stops in roughly 2.8 s,
          // and never fights the automatic demo throttle.
          const acceleration = drive * (34 - speed * 0.063) - drag - (brakePressed ? 105 : 0);
          speed = THREE.MathUtils.clamp(speed + acceleration * dt, 0, 298);
          playerX = THREE.MathUtils.clamp(
            playerX + steer * Math.min(1, speed / 24) * (3.4 + speed * 0.009) * dt,
            -5.55,
            5.55,
          );
          distance = Math.min(5000, distance + (speed / 3.6) * dt);
          elapsed += dt;
          if (network.status === "demo-local") {
            const targetSpeed = THREE.MathUtils.clamp(
              speed + 8 + Math.sin(elapsed * 0.31) * 14 + (distance > rivalDistance ? 5 : -3),
              42,
              274,
            );
            rivalSpeed = THREE.MathUtils.clamp(
              rivalSpeed + Math.min(targetSpeed - rivalSpeed, 32 - rivalSpeed * 0.06) * dt,
              0,
              284,
            );
            rivalDistance = Math.min(5000, rivalDistance + (rivalSpeed / 3.6) * dt);
          }
        }
      } else if (isLobby) {
        speed = THREE.MathUtils.lerp(speed, 74, dt * 0.8);
        playerX = Math.sin(performance.now() * 0.00022) * 0.8;
      } else if (isReplay) {
        replayTime += dt;
        speed = 226 + Math.sin(replayTime * 0.42) * 34;
        playerX = Math.sin(replayTime * 0.28) * 2.2;
      } else if (!isPaused) {
        speed = THREE.MathUtils.lerp(speed, 0, dt * 4.2);
      }

      gear =
        speed < 38 ? 1 : speed < 76 ? 2 : speed < 124 ? 3 : speed < 178 ? 4 : speed < 232 ? 5 : 6;
      const gearFloor = [900, 1900, 2600, 3200, 3900, 4500][gear - 1];
      rpm = THREE.MathUtils.lerp(rpm, gearFloor + ((speed % 52) / 52) * 5600, dt * 7.5);
      const worldSpeed = isPaused ? 0 : isLobby ? 21 : isReplay ? speed / 3.6 : speed / 3.6;

      if (isLobby || isReplay) {
        previewDistance += worldSpeed * dt;
        previewElapsed += dt;
      }
      const totalRoadLength = roadSegments.length * 72;
      for (const segment of roadSegments) {
        segment.position.z += worldSpeed * dt;
        if (segment.position.z > 70) segment.position.z -= totalRoadLength;
      }

      const inTunnel =
        (isRace && distance > 2180 && distance < 3140) ||
        (isReplay && replayTime > 8 && replayTime < 15);
      tunnel.visible = inTunnel;
      scene.fog!.color.setHex(inTunnel ? 0x252c30 : 0xb4bec4);
      (scene.fog as THREE.FogExp2).density = inTunnel ? 0.012 : 0.0032;
      sky.visible = !inTunnel;
      const lightFollow = 1 - Math.exp(-dt * 3);
      skylight.intensity = THREE.MathUtils.lerp(
        skylight.intensity,
        inTunnel ? 0.2 : 2.2,
        lightFollow,
      );
      sunLight.intensity = THREE.MathUtils.lerp(
        sunLight.intensity,
        inTunnel ? 0 : 1.4,
        lightFollow,
      );
      fill.intensity = THREE.MathUtils.lerp(fill.intensity, inTunnel ? 0.08 : 0.55, lightFollow);
      ambient.intensity = THREE.MathUtils.lerp(
        ambient.intensity,
        inTunnel ? 0.06 : 0.2,
        lightFollow,
      );
      scene.environmentIntensity = THREE.MathUtils.lerp(
        scene.environmentIntensity,
        inTunnel ? 0.09 : 0.7,
        lightFollow,
      );
      renderer.toneMappingExposure = THREE.MathUtils.lerp(
        renderer.toneMappingExposure,
        inTunnel ? 1.15 : 1.05,
        dt * 2.2,
      );
      if (inTunnel) {
        for (const segment of tunnelSegments) {
          segment.position.z += worldSpeed * dt;
          if (segment.position.z > 42) segment.position.z -= tunnelSegments.length * 22;
        }
      }

      const raceElapsed = isLobby || isReplay ? previewElapsed : elapsed;
      const viewDistance = isLobby || isReplay ? previewDistance : distance;
      updateCoastalOcean(ocean, raceElapsed);
      if (isRace && !isPaused && network.status !== "conectado") {
        riderBody.speed = speed / 3.6;
        riderBody.lateralPosition = playerX;
        riderBody.distance = distance;
        const impact = applyArcadeTrafficCollisions(
          riderBody,
          trafficField,
          raceElapsed,
          trafficCooldowns,
          elapsed * 1000,
          "view",
        );
        speed = riderBody.speed * 3.6;
        distance = riderBody.distance;
        playerX = riderBody.lateralPosition;
        if (impact) triggerEvent("IMPACTO · RECUPERA CONTROL", 2.1);
      }

      const rivalGap = distance - rivalDistance;
      const gapAhead =
        isLobby || isReplay ? 22 + Math.sin(previewElapsed * 0.4) * 3 : rivalDistance - distance;
      const rivalLane = networkRivalLane ?? 1.55;
      const rivalDeltaX = rivalLane - rival.position.x;
      rival.position.x = THREE.MathUtils.lerp(rival.position.x, rivalLane, 1 - Math.exp(-dt * 6.5));
      rival.position.z = worldZFromGap(gapAhead);
      rival.visible = gapAhead > -VIEW_BEHIND_METERS && gapAhead < VIEW_AHEAD_METERS;
      rival.rotation.z = THREE.MathUtils.lerp(
        rival.rotation.z,
        THREE.MathUtils.clamp(-rivalDeltaX * 0.08, -0.22, 0.22),
        1 - Math.exp(-dt * 7),
      );
      rival.position.y = 0;
      animateVehicleWheels(
        rival,
        isPaused ? 0 : isLobby || isReplay ? worldSpeed : rivalSpeed / 3.6,
        dt,
      );

      const nearbyTraffic = trafficField
        .map((car) => ({ car, rel: car.distance + car.speed * raceElapsed - viewDistance }))
        .filter(({ rel }) => rel > -VIEW_BEHIND_METERS && rel < VIEW_AHEAD_METERS)
        .sort((left, right) => Math.abs(left.rel) - Math.abs(right.rel))
        .slice(0, TRAFFIC_POOL);
      const visibleIds = new Set(nearbyTraffic.map(({ car }) => car.id));
      for (const slot of traffic) {
        if (slot.trafficId && !visibleIds.has(slot.trafficId)) slot.trafficId = null;
        slot.group.visible = false;
      }
      for (const { car, rel } of nearbyTraffic) {
        const slot =
          traffic.find((candidate) => candidate.trafficId === car.id) ??
          traffic.find((candidate) => candidate.trafficId === null);
        if (!slot) continue;
        slot.trafficId = car.id;
        let model = slot.models.get(car.kind);
        if (!model) {
          model = createTrafficVehicle(traffic.indexOf(slot), car.kind);
          slot.models.set(car.kind, model);
          slot.group.add(model);
        }
        for (const variant of slot.models.values()) variant.visible = variant === model;
        // Body dimensions follow simulation; projecting mirrors are cosmetic, not extra collision width.
        model.scale.x = car.width / Number(model.userData.baseWidth);
        model.scale.z = car.length / Number(model.userData.baseLength);
        slot.group.visible = true;
        // The renderer uses the exact lateral position used by collision math;
        // inner-lane drift visibly closes the otherwise permanent centre corridor.
        slot.group.position.set(arcadeTrafficLateralPosition(car), 0, worldZFromGap(rel));
        animateVehicleWheels(model, isPaused ? 0 : car.speed, dt);
      }

      const lean = steer * THREE.MathUtils.clamp(speed / 260, 0, 1) * -0.3;
      playerBike.position.set(playerX, 0, SAME_STATION_Z);
      playerBike.rotation.z = THREE.MathUtils.lerp(
        playerBike.rotation.z,
        lean,
        1 - Math.exp(-dt * 7.5),
      );
      // Both views use the same full motorcycle. Hide only the local rider's body
      // so the first-person camera is not occluded by its own helmet/torso.
      if (playerRider) playerRider.visible = isReplay;
      playerHands.visible = !isReplay;
      animateVehicleWheels(playerBike, worldSpeed, dt);

      if (isReplay) {
        const orbit = replayTime * 0.22;
        camera.position.x = playerX + Math.sin(orbit) * 8.5;
        camera.position.y = 3.0 + Math.sin(replayTime * 0.31) * 1.1;
        camera.position.z = 10 + Math.cos(orbit) * 7.5;
        camera.lookAt(playerX, 0.8, SAME_STATION_Z);
      } else {
        camera.position.x = playerX;
        camera.position.y =
          1.38 +
          (reducedMotionRef.current || isPaused
            ? 0
            : Math.sin(elapsed * 13) * Math.min(0.0025, speed * 0.000015));
        camera.position.z = SAME_STATION_Z + 0.43;
        camera.rotation.order = "YXZ";
        camera.rotation.x = -0.055 + (brakePressed ? -0.018 : 0);
        camera.rotation.y = steer * -0.012;
        camera.rotation.z = reducedMotionRef.current ? lean * 0.12 : lean * 0.28;
      }

      camera.fov = THREE.MathUtils.lerp(
        camera.fov,
        72 + (reducedMotionRef.current ? 0 : Math.min(10, speed / 30)),
        dt * 2.3,
      );
      camera.updateProjectionMatrix();
      drawGauge(playerMotorcycle.canvas, speed, rpm, gear);
      playerMotorcycle.texture.needsUpdate = true;
      // The opponent has the identical instrument, driven by its own telemetry.
      const rivalDisplaySpeed = isLobby || isReplay ? worldSpeed * 3.6 : rivalSpeed;
      drawGauge(
        rivalMotorcycle.canvas,
        rivalDisplaySpeed,
        4000 + rivalDisplaySpeed * 16,
        Math.max(1, Math.min(6, Math.ceil(rivalDisplaySpeed / 48))),
      );
      rivalMotorcycle.texture.needsUpdate = true;
      audio.update(rpm, speed, soundRef.current && (isRace || isReplay));

      eventTimer -= dt;
      if (eventTimer <= 0 && isRace) {
        eventText = events[Math.floor(elapsed / 5.5) % events.length];
      }

      telemetryTimer += dt;
      if (telemetryTimer > 0.08) {
        telemetryTimer = 0;
        telemetryRef.current({
          speed,
          rpm,
          gear,
          distance,
          rivalDistance,
          rivalGap,
          elapsed,
          nearMisses,
          quality: qualityLabel,
          fps,
          event: eventText,
        });
      }

      frameAccumulator += frameDelta;
      frameCount += 1;
      qualityTimer += dt;
      if (qualityTimer >= 2.2) {
        fps = Math.round(frameCount / frameAccumulator);
        if (fps < 47 && qualityIndex > 0) {
          qualityIndex -= 1;
          stableTimer = 0;
          applyQuality();
        } else if (fps > 58 && qualityIndex < 2) {
          stableTimer += qualityTimer;
          if (stableTimer > 8) {
            qualityIndex += 1;
            stableTimer = 0;
            applyQuality();
          }
        } else if (fps < 55) {
          stableTimer = 0;
        }
        frameAccumulator = 0;
        frameCount = 0;
        qualityTimer = 0;
      }

      composer.render();
    };

    applyQuality();
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      window.removeEventListener("pointerdown", enableAudio);
      window.removeEventListener("keydown", enableAudio);
      audio.dispose();
      unsubscribeRival();
      unsubscribeSimulation?.();
      unsubscribeState?.();
      const disposedGeometries = new Set<THREE.BufferGeometry>();
      const disposedMaterials = new Set<THREE.Material>();
      const disposedTextures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!disposedGeometries.has(object.geometry)) {
          object.geometry.dispose();
          disposedGeometries.add(object.geometry);
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (disposedMaterials.has(material)) continue;
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
              value.dispose();
              disposedTextures.add(value);
            }
          }
          material.dispose();
          disposedMaterials.add(material);
        }
      });
      composer.dispose();
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [network, template]);

  return <div className="game-canvas" ref={hostRef} aria-hidden="true" />;
}
