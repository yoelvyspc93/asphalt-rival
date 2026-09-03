import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMotorcycle, MOTORCYCLE_PAINT } from "./motorcycle";
import { createTrafficVehicle, animateVehicleWheels } from "./roadVehicles";
import { createDryAsphaltMaterial, createOvercastSky } from "../overcastEnvironment";

// Geometry tests do not render. The canvas stub covers only instrument/aggregate textures.
let suzuki: THREE.Group;
beforeAll(async () => {
  const file = readFileSync(new URL("../../../public/models/suzuki-gsx-750.glb", import.meta.url));
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  suzuki = (await new GLTFLoader().parseAsync(data, "")).scene;
});

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        fillText() {},
        putImageData() {},
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
      }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function meshes(root: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => {
    expect(object).not.toBeInstanceOf(THREE.Sprite);
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

describe("initial 3D roster", () => {
  it("builds identical motorcycles in two different colours", () => {
    const red = createMotorcycle(0xb82636, 0xe55660, suzuki);
    const blue = createMotorcycle(0x2467a8, 0x7cbeef, suzuki);
    expect(red.group.userData.modelId).toBe("SUZUKI-GSX-750");
    expect(blue.group.userData.modelId).toBe("SUZUKI-GSX-750");
    expect(red.group.userData.paintColor).not.toBe(blue.group.userData.paintColor);
    const left = meshes(red.group);
    const right = meshes(blue.group);
    expect(left.length).toBeGreaterThan(20);
    expect(left).toHaveLength(right.length);
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index].geometry.attributes.position.array;
      const b = right[index].geometry.attributes.position.array;
      expect(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
        Buffer.from(b.buffer, b.byteOffset, b.byteLength),
      )).toBe(true);
      expect(left[index].position.toArray()).toEqual(right[index].position.toArray());
      expect(left[index].scale.toArray()).toEqual(right[index].scale.toArray());
    }
    const size = new THREE.Box3().setFromObject(red.group).getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(2);
    expect(size.y).toBeGreaterThan(1.5);
    expect(red.group.getObjectByName("rider")).toBeDefined();
    expect(red.group.getObjectByName("asphalt-rivals-3d-cockpit")).toBeUndefined();
    expect(red.group.getObjectByName("motorcycle-chassis-3d")).toBeUndefined();
    const painted = (bike: THREE.Group) =>
      meshes(bike)
        .flatMap((part) => [part.material].flat())
        .find((material) => material.name === MOTORCYCLE_PAINT) as THREE.MeshStandardMaterial;
    expect(painted(red.group).color.getHex()).toBe(0xb82636);
    expect(painted(blue.group).color.getHex()).toBe(0x2467a8);
    expect(painted(red.group)).not.toBe(painted(blue.group));
    expect(painted(red.group)).not.toBe(painted(suzuki));
    expect(left[0].geometry).not.toBe(right[0].geometry);
    animateVehicleWheels(red.group, 12, 0.05);
    expect(red.group.getObjectByName("rolling-wheel")?.rotation.x).not.toBe(0);
    expect(blue.group.getObjectByName("rolling-wheel")?.rotation.x).toBeCloseTo(0, 12);
  });

  it("loads a self-contained imported asset with two ground-aligned rotating wheels", () => {
    const size = new THREE.Box3().setFromObject(suzuki);
    expect(size.min.y).toBeCloseTo(0, 4);
    expect(size.getSize(new THREE.Vector3()).z).toBeCloseTo(2.2, 2);
    const wheels: THREE.Object3D[] = [];
    let triangles = 0;
    suzuki.traverse((part) => {
      if (part.userData.wheelRole) wheels.push(part);
      if (part instanceof THREE.Mesh) {
        expect(part.geometry.attributes.position.array.every(Number.isFinite)).toBe(
          true,
        );
        triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
      }
    });
    expect(wheels).toHaveLength(2);
    for (const wheel of wheels) expect(wheel.userData.radius).toBeGreaterThan(0.3);
    expect(triangles).toBeGreaterThan(390000);
  });

  it("uses only two traffic designs with colour variants and independent wheels", () => {
    const types = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      const vehicle = createTrafficVehicle(index, index % 2 ? "van" : "car");
      types.add(vehicle.userData.vehicleType);
      expect(vehicle.userData.baseWidth).toBeGreaterThan(1.5);
      for (const part of meshes(vehicle)) {
        expect(Array.from(part.geometry.attributes.position.array).every(Number.isFinite)).toBe(
          true,
        );
      }
    }
    expect([...types].sort()).toEqual(["sedan", "van"]);
    // Older network snapshots cannot accidentally introduce a third design.
    expect(createTrafficVehicle(0, "truck").userData.vehicleType).toBe("van");
    const first = createTrafficVehicle(0, "car");
    const second = createTrafficVehicle(0, "car");
    animateVehicleWheels(first, 20, 0.016);
    expect(first.getObjectByName("rolling-wheel")?.rotation.x).not.toBe(0);
    expect(second.getObjectByName("rolling-wheel")?.rotation.x).toBeCloseTo(0, 12);
  });
});

describe("overcast, dry map", () => {
  it("has a real sky dome and nonmetallic matte asphalt, not vehicle photographs", () => {
    const sky = createOvercastSky();
    expect(sky.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(sky.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(sky.name).toBe("overcast-cloud-deck");
    const asphalt = createDryAsphaltMaterial(8);
    expect(asphalt.roughness).toBeGreaterThanOrEqual(0.9);
    expect(asphalt.metalness).toBe(0);
    expect(asphalt.map?.image.width).toBe(256);
    expect(asphalt.transparent).toBe(false);
  });
});
