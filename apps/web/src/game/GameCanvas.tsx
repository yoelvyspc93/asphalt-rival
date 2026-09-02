import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { RaceNetworkAdapter } from '../network/raceNetwork';

export type RacePhase = 'lobby' | 'countdown' | 'race' | 'paused' | 'result' | 'replay';

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
  quality: 'ULTRA' | 'ALTA' | 'DINÁMICA';
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
};

type TrafficVehicle = {
  group: THREE.Group;
  speed: number;
  counted: boolean;
  seed: number;
};

const lanes = [-4.65, -1.55, 1.55, 4.65];
const events = ['REBUFO ACTIVO', 'TRACCIÓN ESTABLE', 'VIENTO LATERAL', 'NOVA EN RADAR'];

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

function createSky() {
  const geometry = new THREE.SphereGeometry(850, 32, 20);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x07131d) },
      horizonColor: { value: new THREE.Color(0xb04d42) },
      lowColor: { value: new THREE.Color(0x17212a) },
      offset: { value: 26 },
      exponent: { value: 0.72 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 lowColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float upper = pow(max(h, 0.0), exponent);
        vec3 dusk = mix(horizonColor, topColor, upper);
        vec3 color = mix(lowColor, dusk, smoothstep(-0.16, 0.12, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}

function createSun() {
  const material = new THREE.MeshBasicMaterial({ color: 0xff8d62, fog: false });
  const sun = mesh(new THREE.CircleGeometry(19, 48), material, [-150, 42, -410], false);
  return sun;
}

function createGaugeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

function drawGauge(canvas: HTMLCanvasElement, speed: number, rpm: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#071116';
  context.beginPath();
  context.arc(256, 256, 235, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#29404a';
  context.lineWidth = 12;
  context.stroke();
  context.strokeStyle = '#25d8ef';
  context.lineCap = 'round';
  context.lineWidth = 15;
  context.beginPath();
  context.arc(256, 256, 205, Math.PI * 0.78, Math.PI * (0.78 + Math.min(1.5, rpm / 7300)), false);
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = '#eaf7f8';
  context.font = '700 130px Bahnschrift, sans-serif';
  context.fillText(Math.round(speed).toString(), 256, 285);
  context.fillStyle = '#7f9aa2';
  context.font = '600 32px Bahnschrift, sans-serif';
  context.fillText('KM/H', 256, 340);
  context.fillStyle = '#ff715e';
  context.fillRect(205, 378, Math.min(102, rpm / 90), 8);
}

function createCockpit() {
  const group = new THREE.Group();
  group.name = 'cockpit';
  group.position.set(0, -0.8, -1.15);

  const carbon = mat(0x080d0f, 0.28, 0.78);
  const metal = mat(0x2f3d42, 0.24, 0.88);
  const cyan = mat(0x14cce5, 0.24, 0.66, 0x07343b);
  const glove = mat(0x10161a, 0.55, 0.12);

  const fairing = mesh(new THREE.BoxGeometry(1.45, 0.38, 1.65), carbon, [0, -0.2, -0.7]);
  fairing.rotation.x = -0.11;
  group.add(fairing);

  const tank = mesh(new THREE.SphereGeometry(0.66, 28, 18), cyan, [0, -0.36, 0.15]);
  tank.scale.set(1, 0.7, 1.35);
  group.add(tank);

  const windshieldMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x8bd9e3,
    transparent: true,
    opacity: 0.13,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.3,
    depthWrite: false,
  });
  const windshield = mesh(new THREE.CircleGeometry(0.9, 32, 0, Math.PI), windshieldMaterial, [0, 0.33, -1.2], false);
  windshield.scale.set(1.25, 0.75, 1);
  windshield.rotation.z = Math.PI;
  group.add(windshield);

  const bar = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 10), metal, [0, 0.1, -0.28]);
  bar.rotation.z = Math.PI / 2;
  group.add(bar);

  for (const side of [-1, 1]) {
    const grip = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.44, 12), carbon, [side * 1.0, 0.11, -0.28]);
    grip.rotation.z = Math.PI / 2;
    group.add(grip);

    const arm = mesh(new THREE.CapsuleGeometry(0.13, 0.7, 5, 10), glove, [side * 0.72, -0.44, 0.25]);
    arm.rotation.z = side * -0.55;
    arm.rotation.x = -0.42;
    group.add(arm);

    const hand = mesh(new THREE.SphereGeometry(0.18, 16, 12), glove, [side * 0.93, 0.05, -0.24]);
    hand.scale.set(1.2, 0.72, 1.4);
    group.add(hand);

    const mirrorArm = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), metal, [side * 0.77, 0.43, -0.66]);
    mirrorArm.rotation.z = side * -0.35;
    group.add(mirrorArm);
    const mirror = mesh(new THREE.SphereGeometry(0.19, 18, 10), metal, [side * 0.9, 0.7, -0.65]);
    mirror.scale.set(1.45, 0.68, 0.18);
    group.add(mirror);
  }

  const { canvas, texture } = createGaugeTexture();
  const gaugeMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const gauge = mesh(new THREE.CircleGeometry(0.42, 48), gaugeMaterial, [0, 0.2, -0.52], false);
  group.add(gauge);

  const wheel = mesh(new THREE.TorusGeometry(0.42, 0.08, 12, 30), mat(0x090b0c, 0.78, 0.05), [0, -0.75, -1.75]);
  wheel.rotation.y = Math.PI / 2;
  group.add(wheel);

  const headlight = new THREE.SpotLight(0xbfeeff, 42, 115, Math.PI / 7, 0.45, 1.3);
  headlight.position.set(0, 0.05, -1.2);
  headlight.target.position.set(0, -1, -80);
  group.add(headlight, headlight.target);

  return { group, canvas, texture };
}

function createBike(color: number, accent: number) {
  const bike = new THREE.Group();
  const bodyMat = mat(color, 0.24, 0.62, color);
  const dark = mat(0x090d10, 0.5, 0.5);
  const rider = mat(0x151b20, 0.52, 0.22);
  const accentMat = mat(accent, 0.22, 0.48, accent);

  for (const z of [-0.85, 0.95]) {
    const wheel = mesh(new THREE.TorusGeometry(0.42, 0.095, 10, 24), dark, [0, 0.42, z]);
    wheel.rotation.y = Math.PI / 2;
    bike.add(wheel);
  }
  const chassis = mesh(new THREE.BoxGeometry(0.48, 0.32, 1.8), bodyMat, [0, 0.64, 0]);
  chassis.rotation.x = -0.08;
  bike.add(chassis);
  const tank = mesh(new THREE.SphereGeometry(0.42, 18, 12), bodyMat, [0, 0.96, -0.12]);
  tank.scale.set(0.88, 0.75, 1.25);
  bike.add(tank);
  const tail = mesh(new THREE.BoxGeometry(0.42, 0.22, 0.68), accentMat, [0, 0.9, 0.78]);
  tail.rotation.x = -0.22;
  bike.add(tail);
  const torso = mesh(new THREE.CapsuleGeometry(0.25, 0.7, 5, 10), rider, [0, 1.46, 0.18]);
  torso.rotation.x = Math.PI / 2.8;
  bike.add(torso);
  const helmet = mesh(new THREE.SphereGeometry(0.27, 18, 12), accentMat, [0, 1.62, -0.28]);
  bike.add(helmet);
  const visor = mesh(new THREE.SphereGeometry(0.275, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x071015, 0.08, 0.8), [0, 1.61, -0.31]);
  visor.rotation.x = Math.PI / 2;
  visor.scale.set(1.01, 1.01, 1.01);
  bike.add(visor);
  const tailLight = mesh(new THREE.BoxGeometry(0.28, 0.09, 0.06), mat(0xff2d34, 0.2, 0.2, 0xff0000), [0, 0.92, 1.14], false);
  bike.add(tailLight);
  return bike;
}

function createTrafficVehicle(index: number) {
  const colors = [0x23303a, 0xd3d6d2, 0x6f151d, 0x172736, 0x6d7066, 0xb06b24];
  const color = colors[index % colors.length];
  const vehicle = new THREE.Group();
  const bodyMat = mat(color, 0.36, 0.55);
  const glass = mat(0x07151d, 0.08, 0.72);
  const tire = mat(0x07090a, 0.82, 0.04);
  const length = index % 4 === 0 ? 5.9 : 4.45;
  const height = index % 4 === 0 ? 2.15 : 1.35;

  vehicle.add(mesh(new THREE.BoxGeometry(2.05, 0.52, length), bodyMat, [0, 0.52, 0]));
  const cabin = mesh(new THREE.BoxGeometry(1.76, height * 0.58, length * 0.48), glass, [0, 0.95 + height * 0.16, -0.25]);
  cabin.scale.x = 0.93;
  vehicle.add(cabin);
  for (const x of [-0.92, 0.92]) {
    for (const z of [-length * 0.31, length * 0.31]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 12), tire, [x, 0.34, z]);
      wheel.rotation.z = Math.PI / 2;
      vehicle.add(wheel);
    }
  }
  for (const x of [-0.62, 0.62]) {
    vehicle.add(mesh(new THREE.BoxGeometry(0.33, 0.15, 0.06), mat(0xff281e, 0.2, 0.2, 0xff0000), [x, 0.58, length / 2 + 0.03], false));
  }
  return vehicle;
}

function createRoadSegment(index: number) {
  const group = new THREE.Group();
  group.position.z = 35 - index * 72;

  const road = mesh(new THREE.BoxGeometry(15.2, 0.22, 72), mat(0x11191c, 0.18, 0.42), [0, -0.18, 0], false);
  group.add(road);

  const shoulder = mat(0x384043, 0.4, 0.38);
  group.add(mesh(new THREE.BoxGeometry(1.0, 0.25, 72), shoulder, [-8.08, -0.17, 0], false));
  group.add(mesh(new THREE.BoxGeometry(1.0, 0.25, 72), shoulder, [8.08, -0.17, 0], false));

  const paint = new THREE.MeshStandardMaterial({ color: 0xd6dcce, roughness: 0.32, metalness: 0.1 });
  for (const x of [-3.1, 0, 3.1]) {
    for (let z = -30; z <= 30; z += 12) {
      group.add(mesh(new THREE.BoxGeometry(0.12, 0.025, 5.4), paint, [x, -0.025, z], false));
    }
  }

  const railMat = mat(0x667278, 0.3, 0.72);
  for (const x of [-8.55, 8.55]) {
    group.add(mesh(new THREE.BoxGeometry(0.16, 0.22, 72), railMat, [x, 0.52, 0], false));
    for (let z = -30; z < 34; z += 8) {
      group.add(mesh(new THREE.BoxGeometry(0.12, 0.84, 0.12), railMat, [x, 0.2, z], false));
    }
  }

  const puddleMat = new THREE.MeshPhysicalMaterial({
    color: 0x07141b,
    roughness: 0.06,
    metalness: 0.35,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  for (let p = 0; p < 5; p += 1) {
    const puddle = mesh(new THREE.CircleGeometry(0.7 + (p % 3) * 0.35, 18), puddleMat, [-5.5 + ((index * 3 + p * 5) % 11), -0.035, -28 + p * 13], false);
    puddle.rotation.x = -Math.PI / 2;
    puddle.scale.x = 2.3;
    group.add(puddle);
  }

  if (index % 2 === 0) {
    const lampMat = mat(0x273239, 0.32, 0.72);
    const glow = mat(0xffb56b, 0.18, 0.2, 0xff761c);
    for (const x of [-10.2, 10.2]) {
      group.add(mesh(new THREE.CylinderGeometry(0.08, 0.13, 7, 8), lampMat, [x, 3.4, -8]));
      group.add(mesh(new THREE.BoxGeometry(1.1, 0.12, 0.32), glow, [x + (x < 0 ? 0.45 : -0.45), 6.82, -8], false));
    }
  }

  if (index % 3 === 0) {
    const rockMat = mat(0x313b3b, 0.88, 0.04);
    for (let r = 0; r < 4; r += 1) {
      const rock = mesh(new THREE.DodecahedronGeometry(2.4 + r * 0.55, 0), rockMat, [14 + r * 4.5, 1.2 + r * 0.25, -20 + r * 9]);
      rock.scale.set(1.4, 0.9, 1.8);
      group.add(rock);
    }
  }

  return group;
}

function createTunnelSegment(index: number) {
  const group = new THREE.Group();
  group.position.z = 30 - index * 22;
  const concrete = mat(0x242c2d, 0.72, 0.16);
  const wet = mat(0x0b1518, 0.15, 0.4);
  const light = mat(0xffa94f, 0.2, 0.2, 0xff861f);
  group.add(mesh(new THREE.BoxGeometry(1.2, 6.7, 21), concrete, [-8.5, 3.15, 0]));
  group.add(mesh(new THREE.BoxGeometry(1.2, 6.7, 21), concrete, [8.5, 3.15, 0]));
  group.add(mesh(new THREE.BoxGeometry(18.2, 0.7, 21), concrete, [0, 6.35, 0]));
  group.add(mesh(new THREE.BoxGeometry(15.3, 0.03, 21), wet, [0, -0.02, 0], false));
  if (index % 2 === 0) {
    group.add(mesh(new THREE.BoxGeometry(5.8, 0.12, 0.28), light, [-4.2, 5.92, -6], false));
    group.add(mesh(new THREE.BoxGeometry(5.8, 0.12, 0.28), light, [4.2, 5.92, -6], false));
  }
  return group;
}

function createRain(count: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 38;
    positions[i * 3 + 1] = Math.random() * 18;
    positions[i * 3 + 2] = -Math.random() * 125 + 15;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xb9e7ee,
    size: 0.075,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  return new THREE.Points(geometry, material);
}

function createSpray(count: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 2.8;
    positions[i * 3 + 1] = Math.random() * 1.5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 7;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xd4f4f4, size: 0.16, transparent: true, opacity: 0.23, depthWrite: false }),
  );
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
    filter.type = 'lowpass';
    filter.frequency.value = 780;
    engine = context.createOscillator();
    engine.type = 'sawtooth';
    harmonic = context.createOscillator();
    harmonic.type = 'triangle';
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

export function GameCanvas({ phase, touchInput, reducedMotion, soundEnabled, network, onTelemetry }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const touchRef = useRef(touchInput);
  const reducedMotionRef = useRef(reducedMotion);
  const soundRef = useRef(soundEnabled);
  const telemetryRef = useRef(onTelemetry);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { touchRef.current = touchInput; }, [touchInput]);
  useEffect(() => { reducedMotionRef.current = reducedMotion; }, [reducedMotion]);
  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { telemetryRef.current = onTelemetry; }, [onTelemetry]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0c1820, 0.0115);
    scene.add(createSky(), createSun());

    const camera = new THREE.PerspectiveCamera(72, host.clientWidth / host.clientHeight, 0.05, 900);
    camera.position.set(0, 1.55, 6.5);
    scene.add(camera);

    scene.add(new THREE.HemisphereLight(0x577b91, 0x121719, 1.25));
    const sunLight = new THREE.DirectionalLight(0xffaa82, 3.6);
    sunLight.position.set(-34, 48, 15);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -28;
    sunLight.shadow.camera.right = 28;
    sunLight.shadow.camera.top = 24;
    sunLight.shadow.camera.bottom = -8;
    sunLight.shadow.camera.far = 140;
    scene.add(sunLight);

    const fill = new THREE.DirectionalLight(0x4bcce5, 0.75);
    fill.position.set(18, 12, -30);
    scene.add(fill);

    const water = mesh(
      new THREE.PlaneGeometry(580, 1250, 1, 1),
      new THREE.MeshPhysicalMaterial({ color: 0x071c28, roughness: 0.16, metalness: 0.38, clearcoat: 0.4 }),
      [-274, -0.72, -450],
      false,
    );
    water.rotation.x = -Math.PI / 2;
    scene.add(water);

    const roadSegments = Array.from({ length: 16 }, (_, index) => createRoadSegment(index));
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

    const cockpit = createCockpit();
    camera.add(cockpit.group);

    const rival = createBike(0xc93c38, 0xff7868);
    rival.position.set(-1.55, 0, -28);
    rival.scale.setScalar(1.08);
    scene.add(rival);
    const rivalSpray = createSpray(100);
    rivalSpray.position.set(0, 0.1, 1.2);
    rival.add(rivalSpray);

    const traffic: TrafficVehicle[] = Array.from({ length: 12 }, (_, index) => {
      const group = createTrafficVehicle(index);
      group.position.set(lanes[(index * 3 + 1) % lanes.length], 0, -72 - index * 58 - (index % 3) * 31);
      scene.add(group);
      const spray = createSpray(45);
      spray.position.set(0, 0.08, 2.1);
      group.add(spray);
      return { group, speed: 17 + (index % 5) * 4.2, counted: false, seed: index * 1.71 };
    });

    const rain = createRain(1300);
    scene.add(rain);

    const keys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);

    const audio = createEngineAudio();
    const enableAudio = () => audio.ensure();
    window.addEventListener('pointerdown', enableAudio, { once: true });
    window.addEventListener('keydown', enableAudio, { once: true });

    let speed = 0;
    let rpm = 920;
    let gear = 1;
    let distance = 0;
    let rivalDistance = 0;
    let rivalSpeed = 0;
    let playerX = 0;
    let elapsed = 0;
    let replayTime = 0;
    let nearMisses = 0;
    let eventText = 'SISTEMAS LISTOS';
    let eventTimer = 0;
    let telemetryTimer = 0;
    let qualityIndex = 2;
    let qualityLabel: Telemetry['quality'] = 'ULTRA';
    let fps = 60;
    let frameAccumulator = 0;
    let frameCount = 0;
    let qualityTimer = 0;
    let stableTimer = 0;
    let priorPhase = phaseRef.current;
    const clock = new THREE.Clock();
    let animationFrame = 0;

    const applyQuality = () => {
      const ratios = [0.85, 1.2, 1.65];
      const rainCounts = [420, 850, 1300];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratios[qualityIndex]));
      rain.geometry.setDrawRange(0, rainCounts[qualityIndex]);
      sunLight.shadow.mapSize.set(qualityIndex === 2 ? 2048 : 1024, qualityIndex === 2 ? 2048 : 1024);
      qualityLabel = qualityIndex === 2 ? 'ULTRA' : qualityIndex === 1 ? 'ALTA' : 'DINÁMICA';
    };

    const triggerEvent = (message: string, duration = 1.65) => {
      eventText = message;
      eventTimer = duration;
    };

    const resetTraffic = (vehicle: TrafficVehicle, index: number, far = true) => {
      vehicle.group.position.z = far ? -520 - Math.random() * 520 - index * 18 : -80 - Math.random() * 320;
      vehicle.group.position.x = lanes[Math.floor(Math.random() * lanes.length)];
      vehicle.speed = 16 + Math.random() * 22;
      vehicle.counted = false;
    };

    const onResize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const activePhase = phaseRef.current;
      const isRace = activePhase === 'race';
      const isReplay = activePhase === 'replay';
      const isLobby = activePhase === 'lobby';
      const isPaused = activePhase === 'paused' || activePhase === 'result';

      if (activePhase !== priorPhase) {
        if (activePhase === 'replay') replayTime = 0;
        priorPhase = activePhase;
      }

      const keyboardSteer = (keys.has('KeyA') || keys.has('ArrowLeft') ? -1 : 0)
        + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
      const steer = THREE.MathUtils.clamp(keyboardSteer || touchRef.current.steer, -1, 1);
      const throttlePressed = keys.has('KeyW') || keys.has('ArrowUp') || touchRef.current.throttle;
      const brakePressed = keys.has('KeyS') || keys.has('ArrowDown') || touchRef.current.brake;

      if (isRace) {
        const throttle = throttlePressed ? 1 : 0.42;
        const drag = 0.000032 * speed * speed + 0.55;
        const acceleration = throttle * (34 - speed * 0.063) - drag - (brakePressed ? 52 : 0);
        speed = THREE.MathUtils.clamp(speed + acceleration * dt, 0, 298);
        playerX = THREE.MathUtils.clamp(playerX + steer * (3.4 + speed * 0.009) * dt, -5.55, 5.55);
        distance = Math.min(5000, distance + (speed / 3.6) * dt);
        elapsed += dt;
        rivalSpeed = THREE.MathUtils.clamp(212 + Math.sin(elapsed * 0.31) * 28 + Math.sin(elapsed * 0.93) * 12 + (distance > rivalDistance ? 8 : -4), 178, 284);
        rivalDistance = Math.min(5000, rivalDistance + (rivalSpeed / 3.6) * dt);
        network.sendInput({ throttle, brake: brakePressed ? 1 : 0, steer, timestamp: performance.now() });
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

      gear = speed < 38 ? 1 : speed < 76 ? 2 : speed < 124 ? 3 : speed < 178 ? 4 : speed < 232 ? 5 : 6;
      const gearFloor = [900, 1900, 2600, 3200, 3900, 4500][gear - 1];
      rpm = THREE.MathUtils.lerp(rpm, gearFloor + ((speed % 52) / 52) * 5600, dt * 7.5);
      const worldSpeed = isPaused ? 0 : isLobby ? 21 : isReplay ? speed / 3.6 : speed / 3.6;

      const totalRoadLength = roadSegments.length * 72;
      for (const segment of roadSegments) {
        segment.position.z += worldSpeed * dt;
        if (segment.position.z > 70) segment.position.z -= totalRoadLength;
      }

      const inTunnel = (isRace && distance > 2180 && distance < 3140) || (isReplay && replayTime > 8 && replayTime < 15);
      tunnel.visible = inTunnel;
      scene.fog!.color.setHex(inTunnel ? 0x080c0d : 0x0c1820);
      (scene.fog as THREE.FogExp2).density = inTunnel ? 0.018 : 0.0115;
      renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, inTunnel ? 0.78 : 1.12, dt * 2.2);
      if (inTunnel) {
        for (const segment of tunnelSegments) {
          segment.position.z += worldSpeed * dt;
          if (segment.position.z > 42) segment.position.z -= tunnelSegments.length * 22;
        }
      }

      const rivalGap = distance - rivalDistance;
      const rivalLane = THREE.MathUtils.clamp(-1.55 + Math.sin(elapsed * 0.55 + 1.1) * 2.7, -4.6, 4.6);
      rival.position.x = THREE.MathUtils.lerp(rival.position.x, rivalLane, dt * 1.45);
      rival.position.z = THREE.MathUtils.lerp(rival.position.z, THREE.MathUtils.clamp(-23 - rivalGap * 0.08, -58, -10), dt * 1.6);
      rival.rotation.z = Math.sin(elapsed * 0.55 + 1.1) * -0.13;
      rival.position.y = Math.sin(elapsed * 8.5) * 0.018;

      traffic.forEach((vehicle, index) => {
        if (isPaused) return;
        vehicle.group.position.z += Math.max(4, worldSpeed - vehicle.speed) * dt;
        vehicle.group.position.x += Math.sin(elapsed * 0.18 + vehicle.seed) * dt * 0.08;
        if (vehicle.group.position.z > 28) resetTraffic(vehicle, index);

        if (isRace && vehicle.group.position.z > 2.5 && vehicle.group.position.z < 10 && !vehicle.counted) {
          const lateral = Math.abs(vehicle.group.position.x - playerX);
          vehicle.counted = true;
          if (lateral < 1.38) {
            speed *= 0.53;
            triggerEvent('IMPACTO · RECUPERA CONTROL', 2.1);
          } else if (lateral < 2.52) {
            nearMisses += 1;
            triggerEvent('ADELANTAMIENTO AL LÍMITE');
          }
        }
      });

      const rainPositions = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let index = 0; index < rainPositions.count; index += 1) {
        let y = rainPositions.getY(index) - dt * (24 + speed * 0.035);
        let z = rainPositions.getZ(index) + dt * worldSpeed * 0.52;
        if (y < -0.2) y = 12 + Math.random() * 8;
        if (z > 18) z = -105 - Math.random() * 30;
        rainPositions.setY(index, y);
        rainPositions.setZ(index, z);
      }
      rainPositions.needsUpdate = true;
      rain.position.x = camera.position.x;

      const lean = steer * THREE.MathUtils.clamp(speed / 260, 0.08, 1) * -0.34;
      cockpit.group.rotation.z = THREE.MathUtils.lerp(cockpit.group.rotation.z, lean, dt * 7.5);
      cockpit.group.rotation.x = THREE.MathUtils.lerp(cockpit.group.rotation.x, brakePressed ? -0.075 : throttlePressed ? 0.025 : 0, dt * 4);
      cockpit.group.position.y = -0.8 + Math.sin(elapsed * (5 + rpm / 1700)) * (reducedMotionRef.current ? 0.002 : 0.009);
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, playerX, dt * 5.5);

      if (isReplay) {
        const orbit = replayTime * 0.22;
        camera.position.x = playerX + Math.sin(orbit) * 8.5;
        camera.position.y = 3.0 + Math.sin(replayTime * 0.31) * 1.1;
        camera.position.z = 10 + Math.cos(orbit) * 7.5;
        camera.lookAt(playerX, 0.8, -15);
        cockpit.group.visible = false;
      } else {
        cockpit.group.visible = true;
        camera.position.y = 1.55;
        camera.position.z = 6.5;
        camera.rotation.order = 'YXZ';
        camera.rotation.x = -0.015 + (brakePressed ? -0.018 : 0);
        camera.rotation.y = steer * -0.018;
        camera.rotation.z = reducedMotionRef.current ? lean * 0.12 : lean * 0.32;
      }

      camera.fov = THREE.MathUtils.lerp(camera.fov, 72 + (reducedMotionRef.current ? 0 : Math.min(10, speed / 30)), dt * 2.3);
      camera.updateProjectionMatrix();
      drawGauge(cockpit.canvas, speed, rpm);
      cockpit.texture.needsUpdate = true;
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

      frameAccumulator += dt;
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

      renderer.render(scene, camera);
    };

    applyQuality();
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', enableAudio);
      window.removeEventListener('keydown', enableAudio);
      audio.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          const map = 'map' in material ? (material as THREE.MeshBasicMaterial).map : null;
          map?.dispose();
          material.dispose();
        });
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [network]);

  return <div className="game-canvas" ref={hostRef} aria-hidden="true" />;
}
