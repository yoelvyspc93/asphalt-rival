import * as THREE from "three";

type Section = [z: number, width: number, height: number, centerY: number];

/** Smooth longitudinal shell; cross sections give the body actual volume. */
function shellGeometry(sections: Section[], radialSegments = 32): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [z, width, height, centerY] of sections) {
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      vertices.push(Math.cos(angle) * width, centerY + Math.sin(angle) * height, z);
    }
  }
  for (let i = 0; i < sections.length - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createCockpit(
  color = 0x971e29,
  accentColor = 0xbe2833,
): {
  group: THREE.Group;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const group = new THREE.Group();
  group.name = "asphalt-rivals-3d-cockpit";
  const graphite = new THREE.MeshStandardMaterial({
    color: 0x171d24,
    roughness: 0.48,
    metalness: 0.55,
  });
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.33,
    metalness: 0.42,
    clearcoat: 0.65,
    clearcoatRoughness: 0.28,
  });
  const silver = new THREE.MeshStandardMaterial({
    color: 0xaab5bf,
    roughness: 0.33,
    metalness: 0.83,
  });
  const blackMetal = new THREE.MeshStandardMaterial({
    color: 0x242b31,
    roughness: 0.4,
    metalness: 0.73,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x15181b,
    roughness: 0.91,
    metalness: 0.02,
  });
  const leather = new THREE.MeshStandardMaterial({ color: 0x252a31, roughness: 0.76 });
  const glovePanel = new THREE.MeshStandardMaterial({ color: 0x38424b, roughness: 0.64 });
  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.55,
    metalness: 0.12,
  });
  const bronze = new THREE.MeshStandardMaterial({
    color: 0xbda265,
    roughness: 0.35,
    metalness: 0.82,
  });

  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function ellipsoid(
    position: THREE.Vector3,
    scale: THREE.Vector3,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) {
    const result = mesh(new THREE.SphereGeometry(1, 20, 12), material, parent);
    result.position.copy(position);
    result.scale.copy(scale);
    return result;
  }
  function rod(
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) {
    const delta = b.clone().sub(a);
    const result = mesh(
      new THREE.CylinderGeometry(radius, radius, delta.length(), 12),
      material,
      parent,
    );
    result.position.copy(a).add(b).multiplyScalar(0.5);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return result;
  }
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  function curve(
    points: THREE.Vector3[],
    radius: number,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) {
    return mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, radius, 6, false),
      material,
      parent,
    );
  }

  // The tank is a sculpted closed volume, narrowing under the rider and at its nose.
  const tank = mesh(
    shellGeometry([
      [-0.48, 0.035, 0.025, -0.22],
      [-0.4, 0.2, 0.1, -0.2],
      [-0.24, 0.35, 0.17, -0.19],
      [-0.04, 0.43, 0.21, -0.22],
      [0.2, 0.45, 0.23, -0.29],
      [0.42, 0.39, 0.22, -0.37],
      [0.64, 0.27, 0.16, -0.45],
      [0.82, 0.12, 0.09, -0.47],
      [0.91, 0.001, 0.001, -0.48],
    ]),
    paint,
  );
  tank.name = "sculpted-fuel-tank";
  // A raised center spine and grip panels create contrasting material regions.
  mesh(
    shellGeometry(
      [
        [-0.31, 0.06, 0.018, -0.026],
        [-0.05, 0.085, 0.022, -0.001],
        [0.2, 0.09, 0.022, -0.049],
        [0.44, 0.07, 0.016, -0.151],
        [0.7, 0.03, 0.01, -0.32],
      ],
      16,
    ),
    graphite,
  );
  const fuelCap = mesh(new THREE.CylinderGeometry(0.097, 0.097, 0.016, 32), silver);
  fuelCap.position.set(0, 0.013, 0.015);
  const fuelCenter = mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.02, 24), blackMetal);
  fuelCenter.position.set(0, 0.024, 0.015);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const bolt = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 6), silver);
    bolt.position.set(Math.cos(angle) * 0.082, 0.026, 0.015 + Math.sin(angle) * 0.082);
  }

  // Instrument housing: physically extruded frame with a recessed display.
  const instrument = new THREE.Group();
  instrument.position.set(0, 0.28, -0.69);
  instrument.rotation.x = -0.29;
  group.add(instrument);
  const screenShape = new THREE.Shape();
  screenShape.moveTo(-0.3, -0.15);
  screenShape.lineTo(0.3, -0.15);
  screenShape.quadraticCurveTo(0.34, -0.15, 0.35, -0.1);
  screenShape.lineTo(0.325, 0.125);
  screenShape.quadraticCurveTo(0.32, 0.165, 0.28, 0.17);
  screenShape.lineTo(-0.28, 0.17);
  screenShape.quadraticCurveTo(-0.32, 0.165, -0.325, 0.125);
  screenShape.lineTo(-0.35, -0.1);
  screenShape.quadraticCurveTo(-0.34, -0.15, -0.3, -0.15);
  const frame = mesh(
    new THREE.ExtrudeGeometry(screenShape, {
      depth: 0.072,
      bevelEnabled: true,
      bevelSize: 0.013,
      bevelThickness: 0.01,
      bevelSegments: 3,
      steps: 1,
    }),
    graphite,
    instrument,
  );
  frame.position.z = -0.085;
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const displayMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const display = mesh(new THREE.PlaneGeometry(0.599, 0.249), displayMaterial, instrument);
  display.position.set(0, 0.007, 0.001);
  display.castShadow = false;
  display.receiveShadow = false;
  for (const side of [-1, 1]) {
    const screw = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.005, 6), silver, instrument);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(side * 0.319, -0.117, 0.005);
    rod(v(side * 0.19, 0.1, -0.71), v(side * 0.2, -0.13, -0.45), 0.021, blackMetal);
  }

  // Upper triple clamp, fork adjusters and clip-on handlebars.
  const clamp = ellipsoid(v(0, -0.03, -0.33), v(0.42, 0.045, 0.115), blackMetal);
  clamp.name = "upper-triple-clamp";
  for (const side of [-1, 1]) {
    rod(v(side * 0.26, -0.45, -0.4), v(side * 0.26, 0.06, -0.4), 0.061, silver);
    const adjuster = mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.033, 24), bronze);
    adjuster.position.set(side * 0.26, 0.065, -0.4);
    const adjusterBolt = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.038, 6), silver);
    adjusterBolt.position.set(side * 0.26, 0.085, -0.4);
    rod(v(side * 0.29, -0.025, -0.36), v(side * 0.75, 0.01, -0.06), 0.024, silver);
    rod(v(side * 0.54, 0.017, -0.15), v(side * 0.78, 0.034, 0.01), 0.043, rubber);
    rod(v(side * 0.78, 0.034, 0.01), v(side * 0.825, 0.038, 0.039), 0.045, blackMetal);
    const control = ellipsoid(v(side * 0.505, 0.021, -0.178), v(0.049, 0.069, 0.063), graphite);
    control.rotation.y = side * -0.6;
    ellipsoid(v(side * 0.51, 0.077, -0.14), v(0.014, 0.009, 0.022), accent);
    curve(
      [
        v(side * 0.49, 0.055, -0.24),
        v(side * 0.61, 0.09, -0.26),
        v(side * 0.78, 0.075, -0.16),
        v(side * 0.85, 0.062, -0.09),
      ],
      0.013,
      silver,
    );
    curve(
      [v(side * 0.5, -0.004, -0.2), v(side * 0.4, -0.12, -0.5), v(side * 0.2, -0.2, -0.65)],
      0.008,
      rubber,
    );

    // Shared exterior/interior forearms. With scale .6 and origin (0, 1.02, -.2),
    // the elbow meets the rider upper arm at (+/- .45, 1.18, .12).
    const arm = new THREE.Group();
    arm.name = side < 0 ? "shared-left-forearm" : "shared-right-forearm";
    group.add(arm);
    rod(v(side * 0.75, 0.267, 0.533), v(side * 0.7, 0.02, 0.09), 0.115, leather, arm);
    ellipsoid(v(side * 0.743, 0.245, 0.467), v(0.112, 0.091, 0.15), graphite, arm).rotation.x =
      -0.51;
    rod(v(side * 0.714, 0.087, 0.21), v(side * 0.7, 0.02, 0.09), 0.096, accent, arm);
    const glove = ellipsoid(v(side * 0.669, 0.048, 0.03), v(0.12, 0.073, 0.142), leather, arm);
    glove.rotation.y = side * -0.38;
    const knucklePlate = ellipsoid(
      v(side * 0.668, 0.102, -0.002),
      v(0.089, 0.029, 0.063),
      glovePanel,
      arm,
    );
    knucklePlate.rotation.y = side * -0.38;
    for (let finger = 0; finger < 4; finger += 1) {
      const x = side * (0.59 + finger * 0.043);
      const z = -0.06 + finger * 0.024;
      curve(
        [
          v(x, 0.089, z + 0.04),
          v(x, 0.056, z - 0.027),
          v(x, -0.014, z - 0.035),
          v(x, -0.031, z + 0.005),
        ],
        0.021,
        leather,
        arm,
      );
      ellipsoid(v(x, 0.096, z + 0.011), v(0.017, 0.012, 0.023), graphite, arm);
    }
    curve(
      [
        v(side * 0.586, 0.024, 0.105),
        v(side * 0.557, -0.009, 0.046),
        v(side * 0.583, -0.035, -0.003),
      ],
      0.027,
      leather,
      arm,
    );

    // Wing-shaped fairing shoulders taper forward instead of rectangular blocks.
    const fairing = mesh(
      shellGeometry(
        [
          [-1.06, 0.005, 0.004, 0.22],
          [-0.92, 0.08, 0.05, 0.19],
          [-0.68, 0.12, 0.095, 0.06],
          [-0.38, 0.15, 0.13, -0.06],
          [-0.05, 0.105, 0.12, -0.12],
          [0.19, 0.02, 0.05, -0.17],
          [0.22, 0.001, 0.001, -0.18],
        ],
        20,
      ),
      paint,
    );
    fairing.position.x = side * 0.6;
    fairing.rotation.y = side * -0.21;
    curve(
      [v(side * 0.43, 0.27, -1.02), v(side * 0.6, 0.12, -0.65), v(side * 0.66, -0.03, -0.25)],
      0.014,
      graphite,
    );

    // Dark coated mirror housings and inset reflective surfaces, with real stems.
    curve(
      [v(side * 0.57, 0.19, -0.94), v(side * 0.81, 0.37, -1.01), v(side * 0.96, 0.46, -0.96)],
      0.022,
      graphite,
    );
    const mirror = new THREE.Group();
    mirror.position.set(side * 0.99, 0.47, -0.94);
    mirror.rotation.set(-0.05, side * -0.12, side * -0.11);
    group.add(mirror);
    ellipsoid(v(0, 0, 0), v(0.203, 0.113, 0.061), graphite, mirror);
    const mirrorGlass = new THREE.MeshStandardMaterial({
      color: 0x8ba1af,
      roughness: 0.075,
      metalness: 0.94,
    });
    ellipsoid(v(0, 0, 0.043), v(0.178, 0.092, 0.015), mirrorGlass, mirror);
  }

  // Curved transparent windscreen: thin tessellated surface, never a billboard.
  const windVertices: number[] = [];
  const windIndices: number[] = [];
  const columns = 24;
  const rows = 8;
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = (column / columns) * 2 - 1;
      windVertices.push(
        u * (0.47 - t * 0.13),
        0.23 + t * (0.48 - 0.13 * u * u),
        -0.94 - t * 0.2 + u * u * 0.15,
      );
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      windIndices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const windGeometry = new THREE.BufferGeometry();
  windGeometry.setAttribute("position", new THREE.Float32BufferAttribute(windVertices, 3));
  windGeometry.setIndex(windIndices);
  windGeometry.computeVertexNormals();
  const windscreen = mesh(
    windGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0xadc0cb,
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  windscreen.castShadow = false;
  const edgePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= columns; i += 1) {
    const u = (i / columns) * 2 - 1;
    edgePoints.push(v(u * 0.34, 0.71 - 0.13 * u * u, -1.14 + u * u * 0.15));
  }
  curve(edgePoints, 0.005, silver);
  drawGauge(canvas, 0, 0, 1);
  return { group, canvas, texture };
}

/** Instrument graphics are a texture on the physical TFT screen, not a scene image. */
export function drawGauge(
  canvas: HTMLCanvasElement,
  speed: number,
  rpm: number,
  gear: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = "#0b131b";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#a6b9c8";
  context.font = "600 22px sans-serif";
  context.textAlign = "left";
  context.fillText("ASPHALT RIVALS", 29, 37);
  context.textAlign = "right";
  context.fillStyle = "#80bbae";
  context.fillText("SECO", width - 29, 37);
  const ratio = THREE.MathUtils.clamp(rpm > 1 ? rpm / 14000 : rpm, 0, 1);
  const segments = 35;
  for (let i = 0; i < segments; i += 1) {
    context.fillStyle = i / segments < ratio ? (i > 27 ? "#f45055" : "#c7e3ef") : "#263541";
    context.fillRect(29 + i * 20.3, 58, 16, 20 + i * 0.65);
  }
  context.textAlign = "center";
  context.fillStyle = "#f1f6fa";
  context.font = "700 133px monospace";
  context.fillText(String(Math.max(0, Math.round(speed))).padStart(3, "0"), width * 0.43, 225);
  context.font = "500 23px sans-serif";
  context.fillStyle = "#9aafbf";
  context.fillText("km/h", width * 0.43, 256);
  context.fillStyle = "#182632";
  context.fillRect(592, 122, 113, 118);
  context.font = "700 84px monospace";
  context.fillStyle = "#e1ebf2";
  context.fillText(gear === 0 ? "N" : String(gear), 649, 214);
  context.font = "500 17px sans-serif";
  context.fillStyle = "#96aaba";
  context.fillText("MARCHA", 649, 262);
  context.fillStyle = "#29404d";
  context.fillRect(29, 278, width - 58, 1);
  context.font = "500 17px monospace";
  context.textAlign = "left";
  context.fillStyle = "#abc2ce";
  context.fillText("ABS  ·  TC 2", 29, 306);
  context.textAlign = "right";
  context.fillText("82°C  ·  SPORT", width - 29, 306);
}
