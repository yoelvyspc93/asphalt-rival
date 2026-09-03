import * as THREE from "three";

export type CoastalMaterials = {
  shoulder: THREE.MeshStandardMaterial;
  barrier: THREE.MeshStandardMaterial;
  retainingWall: THREE.MeshStandardMaterial;
  lanePaint: THREE.MeshStandardMaterial;
  asphaltRepair: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  gantry: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
};

function deterministicNoise(x: number, y: number) {
  const value = Math.sin(x * 91.731 + y * 47.153 + 19.19) * 43758.5453;
  return value - Math.floor(value);
}

function surfaceTexture(kind: "rock" | "concrete", maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la textura costera.");
  const pixels = context.createImageData(256, 256);
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const offset = (y * 256 + x) * 4;
      const grain = deterministicNoise(x, y) * 2 - 1;
      const broad = deterministicNoise(Math.floor(x / 7), Math.floor(y / 5)) * 2 - 1;
      const strata = Math.sin(y * 0.31 + Math.sin(x * 0.045) * 2.4);
      const crack =
        kind === "rock" &&
        (deterministicNoise(Math.floor(x / 19), Math.floor(y / 11)) > 0.86 ||
          Math.abs(Math.sin(x * 0.073 + y * 0.021)) < 0.025);
      const base =
        kind === "rock"
          ? 74 + grain * 14 + broad * 10 + strata * 8 - (crack ? 30 : 0)
          : 126 + grain * 10 + broad * 6 - (y % 64 < 2 ? 18 : 0);
      pixels.data[offset] = Math.max(0, base * (kind === "rock" ? 0.84 : 0.9));
      pixels.data[offset + 1] = Math.max(0, base * (kind === "rock" ? 0.94 : 0.96));
      pixels.data[offset + 2] = Math.max(0, base);
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "rock" ? 5 : 3, kind === "rock" ? 2.5 : 12);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

export function createCoastalMaterials(maxAnisotropy: number): CoastalMaterials {
  const rockMap = surfaceTexture("rock", maxAnisotropy);
  const concreteMap = surfaceTexture("concrete", maxAnisotropy);
  return {
    shoulder: new THREE.MeshStandardMaterial({
      color: 0x626a6d,
      map: concreteMap,
      bumpMap: concreteMap,
      bumpScale: 0.018,
      roughness: 0.94,
    }),
    barrier: new THREE.MeshStandardMaterial({
      color: 0x737d81,
      map: concreteMap,
      bumpMap: concreteMap,
      bumpScale: 0.025,
      roughness: 0.9,
    }),
    retainingWall: new THREE.MeshStandardMaterial({
      color: 0x4a5559,
      map: concreteMap,
      bumpMap: concreteMap,
      bumpScale: 0.035,
      roughness: 0.9,
    }),
    lanePaint: new THREE.MeshStandardMaterial({
      color: 0xe9e7dd,
      roughness: 0.72,
      metalness: 0,
    }),
    asphaltRepair: new THREE.MeshStandardMaterial({
      color: 0x22292c,
      roughness: 0.88,
      metalness: 0,
    }),
    rail: new THREE.MeshStandardMaterial({
      color: 0x879399,
      roughness: 0.3,
      metalness: 0.78,
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0x202a30,
      roughness: 0.34,
      metalness: 0.72,
    }),
    lampGlow: new THREE.MeshStandardMaterial({
      color: 0xffd49a,
      emissive: 0xff9b42,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.08,
    }),
    rock: new THREE.MeshStandardMaterial({
      color: 0xc1c9c9,
      map: rockMap,
      bumpMap: rockMap,
      bumpScale: 0.42,
      roughness: 0.98,
      metalness: 0.01,
    }),
    foliage: new THREE.MeshStandardMaterial({
      color: 0x172a26,
      roughness: 0.98,
      metalness: 0,
    }),
    gantry: new THREE.MeshStandardMaterial({
      color: 0x303b41,
      roughness: 0.35,
      metalness: 0.76,
    }),
    sign: new THREE.MeshStandardMaterial({
      color: 0x173d48,
      emissive: 0x0d2731,
      emissiveIntensity: 0.45,
      roughness: 0.42,
      metalness: 0.25,
    }),
  };
}

export function createCliffSegment(index: number, materials: CoastalMaterials) {
  const group = new THREE.Group();
  group.name = "coastal-cliff-segment";
  const columns = 18;
  const rows = 9;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let column = 0; column <= columns; column += 1) {
    const localZ = -36 + (column / columns) * 72;
    const globalZ = index * 72 + localZ;
    const worldColumn = index * columns + column;
    const height =
      13.5 + deterministicNoise(worldColumn, 8) * 5.5 + Math.sin(globalZ * 0.025) * 2.1;
    for (let row = 0; row <= rows; row += 1) {
      const t = row / rows;
      const ledge = Math.floor(t * 5) * 0.13;
      const jitter = (deterministicNoise(index * 73 + column, row * 17) - 0.5) * 0.7;
      positions.push(10.2 + t * 4.7 + ledge + jitter, t * height - 0.25, localZ);
      uvs.push(column / 3.2, t * 3.1);
    }
  }
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const a = column * (rows + 1) + row;
      const b = (column + 1) * (rows + 1) + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const cliff = new THREE.Mesh(geometry, materials.rock);
  cliff.receiveShadow = true;
  cliff.castShadow = true;
  group.add(cliff);

  for (let cluster = 0; cluster < 7; cluster += 1) {
    const z = -31 + cluster * 10.5 + deterministicNoise(index, cluster) * 4;
    const y = 9.8 + deterministicNoise(index + 5, cluster) * 5;
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2 + deterministicNoise(index, cluster + 4) * 1.4, 1),
      materials.foliage,
    );
    crown.scale.set(1.6, 0.75, 1.4);
    crown.position.set(14.5 + deterministicNoise(index, cluster + 7) * 3.5, y, z);
    crown.castShadow = true;
    group.add(crown);
  }
  return group;
}

export function createCoastalGantry(materials: CoastalMaterials) {
  const group = new THREE.Group();
  group.name = "coastal-route-gantry";
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = true;
    group.add(part);
  };
  add(new THREE.BoxGeometry(0.2, 6.6, 0.2), materials.gantry, -8.15, 3.2, 0);
  add(new THREE.BoxGeometry(0.2, 6.6, 0.2), materials.gantry, 8.15, 3.2, 0);
  add(new THREE.BoxGeometry(16.5, 0.22, 0.28), materials.gantry, 0, 6.28, 0);
  add(new THREE.BoxGeometry(4.8, 1.05, 0.16), materials.sign, 0, 5.48, -0.02);
  for (const x of [-5.6, -2.8, 2.8, 5.6]) {
    add(new THREE.BoxGeometry(1.55, 0.08, 0.32), materials.lampGlow, x, 6.06, -0.18);
  }
  return group;
}

export type CoastalOcean = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

export function createCoastalOcean(): CoastalOcean {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x071923) },
      mid: { value: new THREE.Color(0x123541) },
      horizon: { value: new THREE.Color(0x496b75) },
      glint: { value: new THREE.Color(0x9bb0b3) },
    },
  ]);
  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float time;
      varying vec2 oceanUv;
      varying float waveHeight;
      #include <fog_pars_vertex>
      void main() {
        oceanUv = uv;
        vec3 transformed = position;
        float broad = sin(position.x * 0.035 + time * 0.65) * 0.3;
        float crossWave = sin(position.y * 0.073 - time * 0.48 + position.x * 0.018) * 0.14;
        transformed.z += broad + crossWave;
        waveHeight = broad + crossWave;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform vec3 deep;
      uniform vec3 mid;
      uniform vec3 horizon;
      uniform vec3 glint;
      uniform float time;
      varying vec2 oceanUv;
      varying float waveHeight;
      #include <fog_pars_fragment>
      void main() {
        float distanceFade = smoothstep(0.02, 0.95, oceanUv.y);
        vec3 color = mix(deep, mid, 0.42 + distanceFade * 0.38);
        color = mix(color, horizon, pow(distanceFade, 3.0) * 0.42);
        float ripple = sin(oceanUv.x * 260.0 + oceanUv.y * 90.0 - time * 2.2);
        float highlight = smoothstep(0.83, 1.0, ripple + waveHeight * 2.0) * 0.18;
        color += glint * highlight;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(560, 1400, 32, 96), material);
  ocean.name = "dry-coastal-ocean";
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-278, -0.7, -450);
  ocean.receiveShadow = true;
  return ocean;
}

export function updateCoastalOcean(ocean: CoastalOcean, seconds: number) {
  ocean.material.uniforms.time.value = seconds;
}
