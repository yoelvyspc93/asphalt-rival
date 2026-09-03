import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMotorcycleRider } from "./roadVehicles";
import { drawGauge } from "./cockpit";

export const MOTORCYCLE_ASSET_URL = "/models/suzuki-gsx-750.glb";
export const MOTORCYCLE_PAINT = "Car_Paint_-_Red.001";
let cachedTemplate: THREE.Group | null = null;
let pendingTemplate: Promise<THREE.Group> | null = null;

export function getLoadedMotorcycleTemplate() {
  return cachedTemplate;
}

/** Cache the unrendered source; each live bike owns its GPU resources. */
export function loadMotorcycleTemplate(): Promise<THREE.Group> {
  if (cachedTemplate) return Promise.resolve(cachedTemplate);
  if (!pendingTemplate) {
    pendingTemplate = new GLTFLoader()
      .loadAsync(MOTORCYCLE_ASSET_URL)
      .then(({ scene }) => {
        if (!scene.getObjectByName("rolling-wheel")) {
          throw new Error("La Suzuki no contiene las ruedas preparadas.");
        }
        cachedTemplate = scene;
        return scene;
      })
      .catch((error: unknown) => {
        pendingTemplate = null;
        throw error;
      });
  }
  return pendingTemplate;
}

/** Keep only a compact working instrument, never the old tank/fairing over the GLB. */
function createSuzukiInstrument() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  group.name = "suzuki-live-instrument";
  group.position.set(-0.023, 1.095, -0.505);
  group.rotation.x = -0.55;
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.246, 0.112, 0.023),
    new THREE.MeshStandardMaterial({ color: 0x12171b, roughness: 0.62 }),
  );
  housing.castShadow = true;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.224, 0.093),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  screen.position.z = 0.012;
  group.add(housing, screen);
  drawGauge(canvas, 0, 0, 1);
  return { group, canvas, texture };
}

/** One imported Suzuki design for both players, with isolated paint and wheel transforms. */
export function createMotorcycle(color: number, accent: number, template: THREE.Group) {
  const group = template.clone(true);
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  // glTF primitives share attribute buffers. Preserve that sharing inside each bike;
  // geometry.clone() per primitive would duplicate the entire fairing dozens of times.
  const attributes = new Map<
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  >();
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const cloneMaterial = (source: THREE.Material) => {
    let material = materials.get(source);
    if (material) return material;
    material = source.clone();
    for (const [key, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture)) continue;
      let texture = textures.get(value);
      if (!texture) {
        texture = value.clone();
        textures.set(value, texture);
      }
      (material as unknown as Record<string, unknown>)[key] = texture;
    }
    if (material.name === MOTORCYCLE_PAINT && material instanceof THREE.MeshStandardMaterial) {
      material.color.setHex(color);
    }
    materials.set(source, material);
    return material;
  };
  group.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const sourceGeometry = part.geometry as THREE.BufferGeometry;
    let geometry = geometries.get(sourceGeometry);
    if (!geometry) {
      geometry = new THREE.BufferGeometry();
      geometry.name = sourceGeometry.name;
      geometry.setIndex(sourceGeometry.index?.clone() ?? null);
      for (const [name, attribute] of Object.entries(sourceGeometry.attributes)) {
        let copy = attributes.get(attribute);
        if (!copy) {
          copy = attribute.clone();
          attributes.set(attribute, copy);
        }
        geometry.setAttribute(name, copy);
      }
      for (const item of sourceGeometry.groups) geometry.addGroup(item.start, item.count, item.materialIndex);
      geometry.setDrawRange(sourceGeometry.drawRange.start, sourceGeometry.drawRange.count);
      geometry.boundingBox = sourceGeometry.boundingBox?.clone() ?? null;
      geometry.boundingSphere = sourceGeometry.boundingSphere?.clone() ?? null;
      geometries.set(sourceGeometry, geometry);
    }
    part.geometry = geometry;
    part.material = Array.isArray(part.material)
      ? part.material.map(cloneMaterial)
      : cloneMaterial(part.material);
    part.castShadow = true;
    part.receiveShadow = true;
    if ([part.material].flat().some((material) => material.transparent)) part.castShadow = false;
  });
  const rider = createMotorcycleRider(color, accent);
  rider.position.y = -0.085;
  group.add(rider);
  const instrument = createSuzukiInstrument();
  group.add(instrument.group);
  group.name = "suzuki-gsx-750";
  group.userData.modelId = "SUZUKI-GSX-750";
  group.userData.paintColor = color;
  return { group, canvas: instrument.canvas, texture: instrument.texture };
}
