/**
 * Rebuild the self-contained Suzuki asset without opening/executing the .blend.
 * Usage: node apps/web/scripts/convert-suzuki.mjs "<extracted suzuki gsx 750 folder>"
 * Requires the original Srad 750.obj and Srad 750.mtl. No network access is used.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// GLTFExporter uses the browser FileReader API even when there are no images.
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  throw new Error('Usage: node apps/web/scripts/convert-suzuki.mjs "<source folder>"');
}
const outputDirectory = fileURLToPath(new URL("../public/models/", import.meta.url));
const objBytes = await readFile(path.join(sourceDirectory, "Srad 750.obj"));
const mtlBytes = await readFile(path.join(sourceDirectory, "Srad 750.mtl"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const materialDefinitions = new Map();
const missingTextureFiles = new Set();
let current;
for (const rawLine of mtlBytes.toString("utf8").split(/\r?\n/)) {
  const [key, ...values] = rawLine.trim().split(/\s+/);
  if (key === "newmtl") {
    current = { name: values.join(" "), diffuse: [0.3, 0.3, 0.3] };
    materialDefinitions.set(current.name, current);
  } else if (current && key === "Kd") {
    current.diffuse = values.map(Number);
  } else if (current && key === "map_Kd") {
    // The supplied archive has none of these obsolete absolute-path TGA maps.
    // Record their absence rather than loading URLs or silently inventing textures.
    const filename = values
      .join(" ")
      .split(/[\\/]+/)
      .at(-1);
    current.missingMap = filename;
    missingTextureFiles.add(filename);
  }
}

function makeMaterial(definition) {
  const { name, diffuse } = definition;
  const material = new THREE.MeshPhysicalMaterial({
    name,
    color: new THREE.Color().setRGB(...diffuse),
    roughness: 0.48,
    metalness: 0.05,
  });
  if (name.startsWith("Car_Paint")) {
    material.roughness = 0.28;
    material.metalness = 0.28;
    material.clearcoat = 1;
    material.clearcoatRoughness = 0.17;
  } else if (name === "Roue") {
    material.color.setHex(0x17191b);
    material.roughness = 0.94;
    material.metalness = 0;
  } else if (name === "Material.001") {
    material.color.setHex(0x171b20);
    material.roughness = 0.86;
    material.metalness = 0;
  } else if (name === "renan__spec_") {
    material.color.setHex(0x24282d);
    material.roughness = 0.6;
    material.metalness = 0.16;
  } else if (name === "Motor") {
    material.color.setHex(0x4a4a44);
    material.roughness = 0.47;
    material.metalness = 0.8;
  } else if (name === "Echape" || name === "metalpipegold__spec_") {
    material.color.setHex(0x958972);
    material.roughness = 0.34;
    material.metalness = 0.9;
  } else if (name === "dourado__spec_") {
    material.color.setHex(0xbfa263);
    material.roughness = 0.3;
    material.metalness = 0.85;
  } else if (
    name.startsWith("aluminium") ||
    name.includes("__env_") ||
    name === "Material" ||
    name === "Material.004"
  ) {
    material.color.setHex(0xabb0b7);
    material.roughness = 0.32;
    material.metalness = 0.88;
  }
  if (name === "Matte__662F2F2F__spec_trans_") {
    // Windscreen; alpha blending is inexpensive and works without scene capture.
    material.color.setHex(0x8397a1);
    material.transparent = true;
    material.opacity = 0.22;
    material.roughness = 0.12;
    material.metalness = 0;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
  } else if (name === "Matte__57CCCCCC__trans_" || name === "Matte__6BFFFFFF__prim_spec_trans_") {
    material.transparent = true;
    material.opacity = 0.38;
    material.roughness = 0.18;
    material.metalness = 0;
    material.depthWrite = false;
  }
  if (name === "Material.003") {
    material.color.setHex(0xe7edf0);
    material.emissive.setHex(0xd6e3ee);
    material.emissiveIntensity = 0.6;
    material.roughness = 0.2;
  } else if (name === "Matte__FFFF3C00__spec_RR_") {
    material.color.setHex(0xa51414);
    material.emissive.setHex(0xef1720);
    material.emissiveIntensity = 0.45;
    material.roughness = 0.24;
  }
  if (definition.missingMap) material.userData.missingSourceTexture = definition.missingMap;
  return material;
}

const materialLibrary = new Map(
  [...materialDefinitions].map(([name, definition]) => [name, makeMaterial(definition)]),
);
const sourceLines = objBytes.toString("utf8").split(/\r?\n/);
// Construction edges make OBJLoader classify a mixed face/line object as lines.
// They are not triangle surfaces and must not replace the body mesh on import.
const omittedConstructionLines = sourceLines.filter((line) => /^\s*[lp]\s/.test(line)).length;
const sourceTriangleCount = sourceLines.reduce(
  (count, line) => count + (/^\s*f\s/.test(line) ? line.trim().split(/\s+/).length - 3 : 0),
  0,
);
const parsed = new OBJLoader().parse(
  sourceLines.filter((line) => !/^\s*[lp]\s/.test(line)).join("\n"),
);
const originalBounds = new THREE.Box3().setFromObject(parsed);
const originalSize = originalBounds.getSize(new THREE.Vector3());
const scale = 2.2 / originalSize.z;
const centerZ = (originalBounds.min.z + originalBounds.max.z) / 2;
const root = new THREE.Group();
root.name = "suzuki-gsx-750";
root.userData.modelId = "SUZUKI-GSX-750";
root.userData.sourceUnitsToMeters = scale;
root.userData.frontAxis = "-Z";
root.userData.paintMaterialName = "Car_Paint_-_Red.001";
const wheelDefinitions = {
  "Srad750.001": { role: "front", pivot: [0, 0.32918, -0.75441], radius: 0.332 },
  "Srad750.004": { role: "rear", pivot: [0, 0.34734, 0.84554], radius: 0.355 },
};
const parts = [];
let inputTriangles = 0;
let indexedVertexCount = 0;
for (const mesh of [...parsed.children]) {
  if (!mesh.isMesh) throw new Error(`Unexpected source object: ${mesh.name}`);
  const sourceVertexCount = mesh.geometry.attributes.position.count;
  inputTriangles += sourceVertexCount / 3;
  mesh.geometry.scale(scale, scale, scale);
  mesh.geometry.translate(0, -originalBounds.min.y * scale, -centerZ * scale);
  const originalGeometry = mesh.geometry;
  // Welding includes every normal and UV attribute, preserving smoothing/UV seams.
  // No decimation, normal recomputation, quantization, or triangle removal is used.
  mesh.geometry = mergeVertices(originalGeometry, 1e-8);
  originalGeometry.dispose();
  indexedVertexCount += mesh.geometry.attributes.position.count;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.material = materials.map((material) => {
    const replacement = materialLibrary.get(material.name);
    if (!replacement) throw new Error(`Unknown material: ${material.name}`);
    material.dispose();
    return replacement;
  });
  if (mesh.material.length === 1) mesh.material = mesh.material[0];
  for (const attribute of Object.values(mesh.geometry.attributes)) {
    if (!attribute.array.every(Number.isFinite)) throw new Error(`Invalid geometry: ${mesh.name}`);
  }
  const wheel = wheelDefinitions[mesh.name];
  if (wheel) {
    const pivot = new THREE.Vector3(
      wheel.pivot[0] * scale,
      (wheel.pivot[1] - originalBounds.min.y) * scale,
      (wheel.pivot[2] - centerZ) * scale,
    );
    const assembly = new THREE.Group();
    assembly.name = "rolling-wheel";
    assembly.userData.wheelRole = wheel.role;
    assembly.userData.radius = wheel.radius * scale;
    assembly.position.copy(pivot);
    mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
    assembly.add(mesh);
    root.add(assembly);
  } else root.add(mesh);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  parts.push({
    sourceObject: mesh.name,
    triangles: mesh.geometry.index.count / 3,
    vertices: mesh.geometry.attributes.position.count,
    wheelRole: wheel?.role ?? null,
  });
}
root.updateMatrixWorld(true);
if (inputTriangles !== sourceTriangleCount)
  throw new Error("OBJ import changed the triangle count");
const bounds = new THREE.Box3().setFromObject(root);
const bytes = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, trs: true }));
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
  throw new Error("Export did not produce GLB 2.0");
}
const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
const exportedTriangles = document.meshes.reduce(
  (total, mesh) =>
    total +
    mesh.primitives.reduce(
      (sum, primitive) => sum + document.accessors[primitive.indices].count / 3,
      0,
    ),
  0,
);
if (exportedTriangles !== inputTriangles) throw new Error("Export changed the triangle count");
if (document.buffers.some((buffer) => buffer.uri) || document.images?.some((image) => image.uri)) {
  throw new Error("Export unexpectedly references external files");
}
if (document.nodes.filter((node) => node.name === "rolling-wheel").length !== 2) {
  throw new Error("Export lost wheel animation groups");
}
// Round-trip with the game's real loader, including all normals and UV attributes.
const loaded = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
let loadedTriangles = 0;
loaded.scene.traverse((node) => {
  if (!node.isMesh) return;
  if (!node.geometry.attributes.normal || !node.geometry.attributes.uv) {
    throw new Error(`Round-trip lost normal/UV attributes: ${node.name}`);
  }
  loadedTriangles += node.geometry.index.count / 3;
});
if (loadedTriangles !== sourceTriangleCount)
  throw new Error("GLB round-trip changed triangle count");
const manifest = {
  modelId: root.userData.modelId,
  asset: "suzuki-gsx-750.glb",
  source: {
    archive: "suzuki+gsx+750.rar",
    obj: "Srad 750.obj",
    objSha256: sha256(objBytes),
    mtlSha256: sha256(mtlBytes),
    url: "https://www.cgtrader.com/items/2084418/download-page",
    license:
      "Pending verification; supplied locally by the user. Do not assume redistribution rights.",
  },
  conversion: {
    script: "apps/web/scripts/convert-suzuki.mjs",
    command: 'node apps/web/scripts/convert-suzuki.mjs "<extracted suzuki gsx 750 folder>"',
    threeRevision: THREE.REVISION,
    geometry: "Original triangles retained; indexed with normal and UV seams preserved.",
    omittedConstructionLines,
    materials:
      "PBR approximation of source MTL, not a faithful reconstruction of missing image maps.",
    missingTextures: [...missingTextureFiles].sort(),
    packedTextureInspection: "Missing TGA files are not packed in the supplied Blender file.",
    externalDependencies: [],
    validation:
      "GLB 2.0 and Three.js GLTFLoader round-trip checked; every triangle retains normals and UVs.",
    visualApproval:
      "Pending actual game review; conversion metrics are not evidence of visual quality.",
  },
  metrics: {
    bytes: bytes.length,
    sha256: sha256(bytes),
    triangles: exportedTriangles,
    indexedVertices: indexedVertexCount,
    materials: document.materials.length,
    meshObjects: document.meshes.length,
    drawPrimitives: document.meshes.reduce((total, mesh) => total + mesh.primitives.length, 0),
  },
  coordinates: {
    up: "+Y",
    front: "-Z",
    unit: "meter",
    sourceScale: scale,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    wheels: root.children
      .filter((child) => child.name === "rolling-wheel")
      .map((wheel) => ({
        role: wheel.userData.wheelRole,
        center: wheel.position.toArray(),
        radius: wheel.userData.radius,
      })),
  },
  paintMaterial: "Car_Paint_-_Red.001",
  parts,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "suzuki-gsx-750.glb"), bytes);
await writeFile(
  path.join(outputDirectory, "suzuki-gsx-750.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));
