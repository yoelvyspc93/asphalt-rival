import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Metres; forward is -Z and tyres meet y=0. No billboards or photographic volumes.
type V3 = [number, number, number];
type Section = [z: number, width: number, bottom: number, top: number, roofWidth?: number];
const rubber = new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: 0.92 });
const trim = new THREE.MeshStandardMaterial({ color: 0x252a2e, roughness: 0.63, metalness: 0.3 });
const metal = new THREE.MeshStandardMaterial({ color: 0x8b959e, metalness: 0.88, roughness: 0.31 });
const darkMetal = new THREE.MeshStandardMaterial({
  color: 0x41494e,
  metalness: 0.72,
  roughness: 0.4,
});
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x304957,
  metalness: 0.36,
  roughness: 0.17,
  clearcoat: 1,
  side: THREE.DoubleSide,
});
const headlights = new THREE.MeshStandardMaterial({
  color: 0xe5eff3,
  emissive: 0xbed7ed,
  emissiveIntensity: 0.65,
  roughness: 0.25,
});
const taillights = new THREE.MeshStandardMaterial({
  color: 0x8e1220,
  emissive: 0xff1524,
  emissiveIntensity: 0.72,
  roughness: 0.3,
});
const indicator = new THREE.MeshStandardMaterial({
  color: 0xcf7730,
  emissive: 0xa84808,
  emissiveIntensity: 0.25,
});
const plate = new THREE.MeshStandardMaterial({ color: 0xd6d9d6, roughness: 0.6 });
const paint = (color: number) =>
  new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.38,
    roughness: 0.31,
    clearcoat: 0.8,
    clearcoatRoughness: 0.24,
  });

function mesh(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: V3,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.castShadow = result.receiveShadow = true;
  parent.add(result);
  return result;
}
function box(
  parent: THREE.Group,
  size: V3,
  position: V3,
  material: THREE.Material,
  bevel = 0.035,
): THREE.Mesh {
  return mesh(
    parent,
    new RoundedBoxGeometry(...size, 1, Math.min(bevel, Math.min(...size) * 0.3)),
    material,
    position,
  );
}
function sphere(
  parent: THREE.Group,
  scale: V3,
  position: V3,
  material: THREE.Material,
): THREE.Mesh {
  const result = mesh(parent, new THREE.SphereGeometry(1, 16, 10), material, position);
  result.scale.set(...scale);
  return result;
}
function rod(
  parent: THREE.Group,
  from: V3,
  to: V3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const result = mesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, delta.length(), 10),
    material,
    [0, 0, 0],
  );
  result.position.copy(a.add(b).multiplyScalar(0.5));
  result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return result;
}
// Bevelled longitudinal sections preserve bonnet, beltline and boot silhouettes.
function loft(parent: THREE.Group, sections: Section[], material: THREE.Material): THREE.Mesh {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [z, width, bottom, top, roofWidth] of sections) {
    const x = width / 2,
      tx = (roofWidth ?? width) / 2,
      b = Math.min(0.09, (top - bottom) * 0.22);
    vertices.push(
      -x + b,
      bottom,
      z,
      x - b,
      bottom,
      z,
      x,
      bottom + b,
      z,
      tx,
      top - b,
      z,
      tx - b,
      top,
      z,
      -tx + b,
      top,
      z,
      -tx,
      top - b,
      z,
      -x,
      bottom + b,
      z,
    );
  }
  for (let s = 0; s < sections.length - 1; s++)
    for (let p = 0; p < 8; p++) {
      const a = s * 8 + p,
        b = s * 8 + ((p + 1) % 8);
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  for (let p = 1; p < 7; p++) {
    indices.push(0, p + 1, p);
    const end = (sections.length - 1) * 8;
    indices.push(end, end + p, end + p + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return mesh(parent, geometry, material, [0, 0, 0]);
}
function glassPanel(
  parent: THREE.Group,
  hull: THREE.Mesh,
  points: V3[],
  outward: V3,
  rows = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
): void {
  // Actual laminated glass follows the outer body surface with a 4 mm physical skin.
  // Normal depth testing remains enabled; nothing is drawn through the sheet metal.
  hull.updateMatrixWorld(true);
  const axis = new THREE.Vector3(...outward).normalize();
  const raycaster = new THREE.Raycaster();
  const vertices: number[] = [],
    indices: number[] = [];
  const corners = points.map((point) => new THREE.Vector3(...point));
  const columns = 8;
  for (const t of rows) {
    const left = corners[0].clone().lerp(corners[3], t);
    const right = corners[1].clone().lerp(corners[2], t);
    for (let c = 0; c <= columns; c++) {
      const point = left.clone().lerp(right, c / columns);
      raycaster.set(point.clone().addScaledVector(axis, 4), axis.clone().negate());
      const hit = raycaster.intersectObject(hull, false)[0];
      if (hit) point.copy(hit.point);
      point.addScaledVector(axis, 0.004);
      vertices.push(point.x, point.y, point.z);
    }
  }
  for (let row = 0; row < rows.length - 1; row++)
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col;
      const b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  for (let i = 0; i < indices.length; i += 3) {
    const a = new THREE.Vector3().fromArray(vertices, indices[i] * 3);
    const b = new THREE.Vector3().fromArray(vertices, indices[i + 1] * 3);
    const c = new THREE.Vector3().fromArray(vertices, indices[i + 2] * 3);
    if (b.sub(a).cross(c.sub(a)).dot(axis) < 0)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh(parent, geometry, glass, [0, 0, 0]);
}
// Merge only direct solid children. Animated pivots retain independent geometry.
function mergeStatic(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const solid = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    const list = batches.get(solid.material) ?? [];
    list.push(solid);
    batches.set(solid.material, list);
  }
  for (const [material, sources] of batches) {
    const pieces = sources.map((source) => {
      const copy = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone();
      copy.applyMatrix4(source.matrix);
      copy.deleteAttribute("uv");
      return copy;
    });
    const geometry = mergeGeometries(pieces, false);
    if (geometry) {
      mesh(group, geometry, material, [0, 0, 0]).name = "merged-solid-panels";
      sources.forEach((source) => {
        group.remove(source);
        source.geometry.dispose();
      });
    }
    pieces.forEach((piece) => piece.dispose());
  }
}
function wheel(
  parent: THREE.Group,
  position: V3,
  radius: number,
  width: number,
  motorcycle = false,
): void {
  const assembly = new THREE.Group();
  assembly.name = "rolling-wheel";
  assembly.userData.radius = radius;
  const tyre = mesh(
    assembly,
    new THREE.TorusGeometry(radius * 0.76, radius * 0.24, 8, 24),
    rubber,
    [0, 0, 0],
  );
  tyre.rotation.y = Math.PI / 2;
  tyre.scale.z = width / (radius * 0.48);
  const hub = mesh(
    assembly,
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.78, 16),
    darkMetal,
    [0, 0, 0],
  );
  hub.rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    const rim = mesh(assembly, new THREE.TorusGeometry(radius * 0.62, 0.021, 5, 20), metal, [
      side * width * 0.45,
      0,
      0,
    ]);
    rim.rotation.y = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const theta = (i * Math.PI * 2) / 5;
      rod(
        assembly,
        [side * width * 0.46, 0, 0],
        [side * width * 0.46, Math.cos(theta) * radius * 0.56, Math.sin(theta) * radius * 0.56],
        motorcycle ? 0.018 : 0.025,
        metal,
      );
    }
    if (motorcycle) {
      const disc = mesh(assembly, new THREE.RingGeometry(radius * 0.31, radius * 0.59, 20), metal, [
        side * width * 0.55,
        0,
        0,
      ]);
      disc.rotation.y = (side * Math.PI) / 2;
    }
  }
  mergeStatic(assembly);
  assembly.position.set(...position);
  parent.add(assembly);
}
function carWheels(
  group: THREE.Group,
  halfWidth: number,
  front: number,
  rear: number,
  radius: number,
): void {
  for (const x of [-halfWidth, halfWidth])
    for (const z of [front, rear]) wheel(group, [x, radius, z], radius, 0.25);
}
function rearDetails(group: THREE.Group, halfWidth: number, z: number, y: number): void {
  box(group, [0.47, 0.14, 0.025], [0, y - 0.1, z], plate, 0.007);
  box(group, [0.34, 0.025, 0.031], [0, y - 0.1, z + 0.014], trim, 0.003);
  for (const side of [-1, 1]) {
    box(group, [0.37, 0.12, 0.075], [side * (halfWidth - 0.24), y + 0.07, z], taillights, 0.02);
    box(
      group,
      [0.12, 0.055, 0.08],
      [side * (halfWidth - 0.13), y + 0.11, z + 0.005],
      indicator,
      0.01,
    );
  }
}
function sedan(color: number): THREE.Group {
  const group = new THREE.Group(),
    body = paint(color);
  loft(
    group,
    [
      [-2.26, 1.62, 0.4, 0.83],
      [-1.83, 1.91, 0.4, 1.01],
      [-1.73, 1.94, 0.59, 1.02],
      [-1.4, 1.94, 0.735, 1.04],
      [-1.07, 1.94, 0.59, 1.04],
      [-0.96, 1.94, 0.32, 1.04],
      [0.9, 1.94, 0.32, 1.04],
      [1.01, 1.94, 0.59, 1.04],
      [1.34, 1.94, 0.735, 1.04],
      [1.67, 1.91, 0.59, 1.02],
      [1.79, 1.88, 0.4, 1],
      [2.12, 1.8, 0.41, 0.96],
    ],
    body,
  );
  const cabin = loft(
    group,
    [
      [-0.93, 1.74, 0.96, 1.04],
      [-0.36, 1.76, 0.99, 1.57, 1.44],
      [0.81, 1.76, 0.99, 1.57, 1.43],
      [1.44, 1.73, 0.97, 1.02],
    ],
    body,
  );
  glassPanel(
    group,
    cabin,
    [
      [-0.79, 1.1, -0.88],
      [0.79, 1.1, -0.88],
      [0.63, 1.524, -0.42],
      [-0.63, 1.524, -0.42],
    ],
    [0, 1, 0],
  );
  glassPanel(
    group,
    cabin,
    [
      [-0.62, 1.53, 0.87],
      [0.62, 1.53, 0.87],
      [0.78, 1.11, 1.36],
      [-0.78, 1.11, 1.36],
    ],
    [0, 1, 0],
  );
  for (const side of [-1, 1]) {
    glassPanel(
      group,
      cabin,
      [
        [side * 0.877, 1.105, -0.77],
        [side * 0.738, 1.46, -0.29],
        [side * 0.735, 1.46, 0.22],
        [side * 0.88, 1.105, 0.22],
      ],
      [side, 0, 0],
    );
    glassPanel(
      group,
      cabin,
      [
        [side * 0.88, 1.105, 0.31],
        [side * 0.735, 1.46, 0.31],
        [side * 0.733, 1.46, 0.75],
        [side * 0.873, 1.105, 1.3],
      ],
      [side, 0, 0],
    );
    rod(group, [side * 0.895, 1.047, -0.76], [side * 0.895, 1.047, 1.33], 0.016, metal);
    rod(group, [side * 0.963, 0.42, -1.12], [side * 0.963, 0.42, 1.14], 0.035, trim);
    box(group, [0.17, 0.09, 0.25], [side * 1.01, 1.1, -0.63], body);
    box(group, [0.014, 0.055, 0.17], [side * 1.102, 1.11, -0.6], glass, 0.01);
    for (const z of [0.13, 1.04])
      box(group, [0.032, 0.038, 0.16], [side * 0.965, 0.92, z], metal, 0.008);
    box(group, [0.43, 0.11, 0.08], [side * 0.59, 0.83, -2.19], headlights);
  }
  box(group, [1.55, 0.16, 0.16], [0, 0.43, 2.09], trim);
  box(group, [0.76, 0.16, 0.025], [0, 0.61, -2.267], trim);
  rearDetails(group, 0.91, 2.12, 0.81);
  carWheels(group, 0.89, -1.4, 1.34, 0.34);
  mergeStatic(group);
  return group;
}
function van(color: number): THREE.Group {
  const group = new THREE.Group(),
    body = paint(color);
  const cabin = loft(
    group,
    [
      [-2.45, 1.76, 0.38, 1.06],
      [-1.98, 2, 0.38, 1.24],
      [-1.87, 2, 0.65, 1.24],
      [-1.51, 2, 0.81, 1.4],
      [-1.15, 2, 0.65, 1.87],
      [-1.04, 2, 0.36, 2.03],
      [-0.85, 2.01, 0.36, 2.28],
      [1.06, 2.01, 0.36, 2.28],
      [1.17, 2.01, 0.65, 2.28],
      [1.53, 2.01, 0.81, 2.28],
      [1.89, 2, 0.65, 2.28],
      [2, 2, 0.38, 2.28],
      [2.3, 2, 0.38, 2.28],
    ],
    body,
  );
  glassPanel(
    group,
    cabin,
    [
      [-0.88, 1.44, -1.49],
      [0.88, 1.44, -1.49],
      [0.88, 2.2, -0.94],
      [-0.88, 2.2, -0.94],
    ],
    [0, 1, 0],
    [0, 0.2, 0.4, (-1.15 + 1.49) / 0.55, (-1.04 + 1.49) / 0.55, 1],
  );
  for (const side of [-1, 1]) {
    glassPanel(
      group,
      cabin,
      [
        [side * 1.008, 1.3, -1.52],
        [side * 1.008, 2.13, -0.83],
        [side * 1.008, 2.13, -0.2],
        [side * 1.008, 1.3, -0.2],
      ],
      [side, 0, 0],
    );
    box(group, [0.13, 0.22, 0.3], [side * 1.1, 1.41, -1.31], trim);
    box(group, [0.025, 0.18, 2.25], [side * 1.01, 0.58, 0.8], trim, 0.006);
    box(group, [0.032, 0.032, 1.86], [side * 1.016, 1.08, 0.85], metal, 0.004);
    box(group, [0.028, 0.05, 0.18], [side * 1.019, 1.22, 0.15], trim, 0.008);
    rod(group, [side * 1.009, 0.77, -0.08], [side * 1.009, 2.12, -0.08], 0.008, darkMetal);
    box(group, [0.43, 0.19, 0.08], [side * 0.61, 1, -2.4], headlights);
    box(group, [0.18, 0.5, 0.042], [side * 0.83, 1.07, 2.313], taillights);
    box(group, [0.8, 0.6, 0.025], [side * 0.48, 1.78, 2.31], glass);
    for (const y of [0.88, 1.89])
      box(group, [0.045, 0.13, 0.04], [side * 0.91, y, 2.32], metal, 0.008);
  }
  box(group, [0.018, 1.72, 0.023], [0, 1.36, 2.322], trim, 0.002);
  box(group, [1.94, 0.18, 0.16], [0, 0.44, 2.34], trim);
  box(group, [1.4, 0.2, 0.06], [0, 0.68, -2.447], trim);
  box(group, [0.46, 0.15, 0.03], [0, 0.75, 2.33], plate);
  carWheels(group, 0.96, -1.51, 1.53, 0.375);
  mergeStatic(group);
  return group;
}
const trafficTemplates = new Map<string, THREE.Group>();
export function createTrafficVehicle(index: number, kind?: "car" | "van" | "truck"): THREE.Group {
  const normalized = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  // Exactly two vehicle designs; legacy truck records use the van geometry.
  const type = kind ? (kind === "car" ? "sedan" : "van") : normalized % 3 === 0 ? "van" : "sedan";
  const colors = [0x536570, 0x7e3335, 0xc2c6c6, 0x3c5255, 0x293849, 0x827664];
  const color = colors[normalized % colors.length],
    key = `${type}-${color}`;
  let template = trafficTemplates.get(key);
  if (!template) {
    template = type === "van" ? van(color) : sedan(color);
    template.name = `traffic-${type}-3d`;
    template.userData.vehicleType = type;
    template.userData.baseWidth = type === "van" ? 2.01 : 1.94;
    template.userData.baseLength = type === "van" ? 4.88 : 4.42;
    trafficTemplates.set(key, template);
  }
  return template.clone(true);
}
export function createMotorcycleChassis(color: number, accent: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "motorcycle-chassis-3d";
  const body = paint(color),
    detail = paint(accent);
  wheel(group, [0, 0.32, -0.78], 0.32, 0.14, true);
  wheel(group, [0, 0.34, 0.76], 0.34, 0.205, true);
  loft(
    group,
    [
      [-0.64, 0.22, 0.4, 0.59],
      [-0.45, 0.55, 0.33, 0.64],
      [-0.05, 0.51, 0.3, 0.61],
      [0.4, 0.34, 0.42, 0.6],
    ],
    body,
  );
  loft(
    group,
    [
      [0.2, 0.37, 0.76, 0.87],
      [0.8, 0.38, 0.85, 0.99],
      [1.02, 0.17, 0.93, 1],
    ],
    body,
  );
  box(group, [0.32, 0.06, 0.4], [0, 0.9, 0.37], rubber);
  box(group, [0.13, 0.045, 0.07], [0, 0.947, 1.017], taillights);
  box(group, [0.12, 0.06, 0.06], [0, 0.86, -0.93], headlights);
  box(group, [0.12, 0.18, 0.026], [0, 0.72, 0.99], plate);
  for (const side of [-1, 1]) {
    rod(group, [side * 0.105, 0.36, -0.78], [side * 0.13, 0.75, -0.6], 0.033, metal);
    rod(group, [side * 0.115, 0.34, 0.76], [side * 0.16, 0.47, 0.05], 0.052, darkMetal);
    rod(group, [side * 0.21, 0.56, -0.03], [side * 0.18, 0.84, 0.37], 0.035, darkMetal);
    box(group, [0.03, 0.08, 0.35], [side * 0.286, 0.63, -0.15], detail);
    rod(group, [side * 0.19, 0.42, 0.36], [side * 0.3, 0.42, 0.36], 0.025, metal);
  }
  rod(group, [0.25, 0.44, 0.1], [0.29, 0.52, 0.84], 0.071, darkMetal);
  rod(group, [0.29, 0.52, 0.83], [0.29, 0.53, 0.95], 0.063, metal);
  mergeStatic(group);
  group.add(createMotorcycleRider(color, accent));
  return group;
}

/** Rider is independent from the vehicle asset; no procedural chassis is attached. */
export function createMotorcycleRider(color: number, accent: number): THREE.Group {
  const body = paint(color);
  const detail = paint(accent);
  const suit = new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.78 });
  // Named rider groups are available for host animation; the limbs have actual volume.
  const rider = new THREE.Group();
  rider.name = "rider";
  sphere(rider, [0.19, 0.15, 0.19], [0, 1.05, 0.39], suit);
  rod(rider, [0, 1.08, 0.33], [0, 1.43, -0.13], 0.2, suit).name = "rider-torso";
  sphere(rider, [0.22, 0.11, 0.28], [0, 1.35, 0.08], body);
  const helmet = new THREE.Group();
  helmet.name = "rider-head";
  sphere(helmet, [0.185, 0.218, 0.218], [0, 0, 0], detail);
  sphere(helmet, [0.174, 0.101, 0.124], [0, 0.012, -0.129], glass);
  box(helmet, [0.095, 0.04, 0.026], [0, -0.12, -0.192], trim, 0.01);
  helmet.position.set(0, 1.58, -0.36);
  rider.add(helmet);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? "rider-left-arm" : "rider-right-arm";
    rod(arm, [side * 0.21, 1.4, -0.13], [side * 0.45, 1.18, 0.12], 0.077, suit);
    sphere(arm, [0.087, 0.084, 0.08], [side * 0.24, 1.37, -0.16], detail);
    const shoulder = new THREE.Vector3(side * 0.21, 1.4, -0.13);
    arm.children.forEach((child) => child.position.sub(shoulder));
    mergeStatic(arm);
    arm.position.copy(shoulder);
    rider.add(arm);
    const leg = new THREE.Group();
    leg.name = side < 0 ? "rider-left-leg" : "rider-right-leg";
    rod(leg, [side * 0.13, 1.05, 0.39], [side * 0.33, 0.71, -0.06], 0.102, suit);
    rod(leg, [side * 0.33, 0.71, -0.06], [side * 0.25, 0.43, 0.38], 0.073, suit);
    sphere(leg, [0.078, 0.092, 0.089], [side * 0.33, 0.71, -0.06], trim);
    box(leg, [0.14, 0.13, 0.26], [side * 0.25, 0.45, 0.3], rubber, 0.04);
    const hip = new THREE.Vector3(side * 0.13, 1.05, 0.39);
    leg.children.forEach((child) => child.position.sub(hip));
    mergeStatic(leg);
    leg.position.copy(hip);
    rider.add(leg);
  }
  return rider;
}
// Compatibility while existing hosts move to the common motorcycle factory.
export const createRivalBike = createMotorcycleChassis;

export function animateVehicleWheels(
  group: THREE.Group,
  speedMetersPerSecond: number,
  dt: number,
): void {
  if (!Number.isFinite(speedMetersPerSecond) || !Number.isFinite(dt) || dt <= 0) return;
  // Resolve after cloning so template instances never share wheel transforms.
  let wheels = group.userData.animatedWheels as THREE.Object3D[] | undefined;
  if (!wheels) {
    wheels = [];
    group.traverse((child) => {
      if (child.name === "rolling-wheel" || child.userData.wheelRole) wheels!.push(child);
    });
    group.userData.animatedWheels = wheels;
  }
  for (const assembly of wheels)
    assembly.rotation.x =
      (assembly.rotation.x -
        (speedMetersPerSecond * Math.min(dt, 0.1)) / (assembly.userData.radius as number)) %
      (Math.PI * 2);
}
