import * as THREE from "three";

const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function addMesh(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function ellipsoid(
  parent: THREE.Group,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  material: THREE.Material,
  segments = 24,
) {
  const mesh = addMesh(parent, new THREE.SphereGeometry(1, segments, 16), material, position);
  mesh.scale.copy(scale);
  return mesh;
}

function capsule(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const delta = to.clone().sub(from);
  const geometry = new THREE.CapsuleGeometry(
    radius,
    Math.max(0.012, delta.length() - radius * 2),
    8,
    18,
  );
  const mesh = addMesh(parent, geometry, material, from.clone().add(to).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function addGlovedHand(
  parent: THREE.Group,
  side: -1 | 1,
  wrist: THREE.Vector3,
  leather: THREE.Material,
  armor: THREE.Material,
) {
  const hand = new THREE.Group();
  hand.name = side < 0 ? "left-glove" : "right-glove";
  hand.position.copy(wrist);
  hand.rotation.set(-0.16, side * 0.08, side * 0.14);
  parent.add(hand);

  const palm = ellipsoid(hand, point(0, 0, -0.012), point(0.074, 0.045, 0.1), leather, 20);
  palm.rotation.z = side * -0.18;
  const knuckles = ellipsoid(hand, point(0, 0.031, -0.045), point(0.062, 0.022, 0.052), armor, 18);
  knuckles.rotation.z = side * -0.18;

  for (let index = 0; index < 4; index += 1) {
    const across = side * (-0.046 + index * 0.031);
    capsule(
      hand,
      point(across, 0.006, -0.065),
      point(across + side * 0.006, -0.018, -0.13),
      0.0125,
      leather,
    );
  }
  capsule(
    hand,
    point(side * 0.058, -0.004, 0.006),
    point(side * 0.088, -0.024, -0.06),
    0.017,
    leather,
  );
  return hand;
}

function riderMaterials(color: number, accent: number) {
  const suit = new THREE.MeshPhysicalMaterial({
    color: 0x11171c,
    roughness: 0.64,
    metalness: 0.08,
    clearcoat: 0.24,
    clearcoatRoughness: 0.54,
  });
  const panels = new THREE.MeshStandardMaterial({
    color: 0x29323a,
    roughness: 0.56,
    metalness: 0.18,
  });
  const leather = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.78 });
  const armor = new THREE.MeshPhysicalMaterial({
    color: 0x303941,
    roughness: 0.4,
    metalness: 0.34,
    clearcoat: 0.42,
  });
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    metalness: 0.28,
    clearcoat: 0.9,
    clearcoatRoughness: 0.18,
  });
  const accentPaint = paint.clone();
  accentPaint.color.setHex(accent);
  const visor = new THREE.MeshPhysicalMaterial({
    color: 0x142633,
    roughness: 0.1,
    metalness: 0.58,
    clearcoat: 1,
  });
  return { suit, panels, leather, armor, accentPaint, visor };
}

/** Leaned sport-riding silhouette, positioned against the imported GSX seat and controls. */
export function createSuzukiRider(color: number, accent: number) {
  const rider = new THREE.Group();
  rider.name = "rider";
  const { suit, panels, leather, armor, accentPaint, visor } = riderMaterials(color, accent);

  const hip = point(0, 0.96, 0.31);
  const chest = point(0, 1.2, 0.04);
  const shoulderCenter = point(0, 1.31, -0.08);
  const torso = ellipsoid(
    rider,
    hip.clone().lerp(shoulderCenter, 0.55),
    point(0.205, 0.31, 0.145),
    suit,
    28,
  );
  torso.name = "rider-torso";
  torso.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    shoulderCenter.clone().sub(hip).normalize(),
  );
  ellipsoid(rider, hip, point(0.18, 0.12, 0.18), suit, 24);
  const backProtector = ellipsoid(
    rider,
    chest.clone().add(point(0, 0.015, 0.123)),
    point(0.135, 0.205, 0.035),
    panels,
    24,
  );
  backProtector.rotation.x = -0.59;

  for (const side of [-1, 1] as const) {
    const shoulder = point(side * 0.18, 1.29, -0.065);
    const elbow = point(side * 0.315, 1.145, -0.15);
    const wrist = point(side * 0.374, 1.045, -0.355);
    capsule(rider, shoulder, elbow, 0.072, suit);
    capsule(rider, elbow, wrist, 0.06, suit);
    ellipsoid(rider, elbow, point(0.075, 0.067, 0.078), armor, 20);
    addGlovedHand(rider, side, wrist, leather, armor);

    const thigh = point(side * 0.145, 0.91, 0.3);
    const knee = point(side * 0.285, 0.67, -0.045);
    const ankle = point(side * 0.245, 0.44, 0.27);
    capsule(rider, thigh, knee, 0.095, suit);
    capsule(rider, knee, ankle, 0.073, suit);
    ellipsoid(rider, knee, point(0.095, 0.085, 0.1), armor, 20);
    const boot = ellipsoid(rider, ankle, point(0.082, 0.09, 0.165), leather, 22);
    boot.rotation.x = -0.17;
  }

  const helmet = new THREE.Group();
  helmet.name = "rider-head";
  helmet.position.set(0, 1.49, -0.32);
  helmet.rotation.x = -0.18;
  rider.add(helmet);
  ellipsoid(helmet, point(0, 0, 0), point(0.165, 0.19, 0.18), accentPaint, 32);
  const visorShell = ellipsoid(
    helmet,
    point(0, 0.018, -0.137),
    point(0.135, 0.072, 0.065),
    visor,
    28,
  );
  visorShell.rotation.x = -0.12;
  const chin = ellipsoid(helmet, point(0, -0.095, -0.14), point(0.13, 0.085, 0.1), accentPaint, 28);
  chin.rotation.x = 0.18;

  return rider;
}

/** Local-only arms that remain when the helmet/torso are hidden by the first-person camera. */
export function createFirstPersonHands(color: number, accent: number) {
  const group = new THREE.Group();
  group.name = "first-person-hands";
  const { suit, panels, leather, armor, accentPaint } = riderMaterials(color, accent);
  for (const side of [-1, 1] as const) {
    const forearm = point(side * 0.5, 0.98, -0.12);
    const wrist = point(side * 0.374, 1.045, -0.355);
    capsule(group, forearm, wrist, 0.036, suit);
    const stripeStart = forearm.clone().lerp(wrist, 0.18);
    const stripeEnd = forearm.clone().lerp(wrist, 0.76);
    stripeStart.y += 0.035;
    stripeEnd.y += 0.035;
    capsule(group, stripeStart, stripeEnd, 0.009, accentPaint);
    const cuff = ellipsoid(
      group,
      wrist.clone().add(point(0, 0.004, 0.018)),
      point(0.048, 0.038, 0.052),
      panels,
      18,
    );
    cuff.rotation.z = side * 0.1;
    const glove = addGlovedHand(group, side, wrist, leather, armor);
    glove.scale.setScalar(0.82);
  }
  return group;
}
