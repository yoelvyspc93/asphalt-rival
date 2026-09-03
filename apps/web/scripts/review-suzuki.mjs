import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const output = path.resolve(process.argv[2] ?? "artifacts/suzuki-review");
const origin = process.env.REVIEW_ORIGIN ?? "http://localhost:5173";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "JUGAR DEMO LOCAL" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".model-loading"));
  await page.getByRole("button", { name: "JUGAR DEMO LOCAL" }).click();
  await page.waitForSelector(".phase-race");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1800);
  await page.keyboard.up("ArrowUp");
  await page.screenshot({ path: path.join(output, "suzuki-gameplay.png") });
  console.log("Game loaded and local demo started.");

  await page.route("**/__model-review", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><body style="margin:0;background:#b4bec4"></body></html>',
  }));
  await page.goto(origin + "/__model-review");
  const stats = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { loadMotorcycleTemplate, createMotorcycle } = await import("/src/game/models/motorcycle.ts");
    const { createOvercastSky } = await import("/src/game/overcastEnvironment.ts");
    const source = await loadMotorcycleTemplate();
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 1000);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.append(renderer.domElement);
    const sky = createOvercastSky();
    scene.add(sky);
    const lightScene = new THREE.Scene();
    lightScene.add(sky.clone());
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(lightScene).texture;
    scene.environmentIntensity = 0.7;
    scene.add(new THREE.HemisphereLight(0xd5dde3, 0x5a605d, 2.2));
    const key = new THREE.DirectionalLight(0xe3e7e9, 1.4);
    key.position.set(-3, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.normalBias = 0.012;
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color: 0x747c7e, roughness: 0.96}));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.004;
    floor.receiveShadow = true;
    scene.add(floor);
    const red = createMotorcycle(0xb82636, 0xe55660, source).group;
    const blue = createMotorcycle(0x2467a8, 0x7cbeef, source).group;
    red.getObjectByName("rider").visible = false;
    blue.getObjectByName("rider").visible = false;
    red.position.x = -0.8;
    blue.position.x = 0.8;
    scene.add(red, blue);
    const camera = new THREE.PerspectiveCamera(40, 1440 / 1000, 0.04, 900);
    camera.position.set(4.5, 2.1, -5);
    camera.lookAt(0, 0.65, 0);
    renderer.render(scene, camera);
    window.reviewSuzuki = { THREE, scene, renderer, camera, red, blue };
    return { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  });
  await page.screenshot({ path: path.join(output, "suzuki-two-colors.png") });
  await page.evaluate(() => {
    const { renderer, scene, camera, red, blue } = window.reviewSuzuki;
    blue.visible = false;
    red.position.x = 0;
    camera.position.set(3.6, 1.3, 0.2);
    camera.lookAt(0, 0.68, 0);
    renderer.render(scene, camera);
  });
  await page.screenshot({ path: path.join(output, "suzuki-side.png") });
  await page.evaluate(() => {
    const { renderer, scene, camera } = window.reviewSuzuki;
    camera.fov = 72;
    camera.updateProjectionMatrix();
    camera.position.set(0, 1.38, 0.43);
    camera.rotation.set(-0.055, 0, 0, "YXZ");
    renderer.render(scene, camera);
  });
  await page.screenshot({ path: path.join(output, "suzuki-cockpit.png") });

  // A fresh context proves that an unavailable model has a visible, recoverable error.
  const errorPage = await browser.newPage({ viewport: { width: 1000, height: 750 } });
  errorPage.setDefaultTimeout(30000);
  errorPage.on("console", (message) => { if (message.type() === "error") console.log("LOAD TEST", message.text()); });
  await errorPage.route("**/models/suzuki-gsx-750.glb", (route) => route.fulfill({ status: 503, body: "Test unavailable" }));
  await errorPage.goto(origin);
  await errorPage.getByRole("heading", { name: "No se pudo cargar la Suzuki" }).waitFor();
  await errorPage.screenshot({ path: path.join(output, "suzuki-load-error.png") });
  await errorPage.unroute("**/models/suzuki-gsx-750.glb");
  await errorPage.getByRole("button", { name: "REINTENTAR" }).click();
  await errorPage.waitForFunction(() => !document.querySelector(".model-loading"), null, { timeout: 20000 }).catch(async (error) => {
    console.log("Retry state:", await errorPage.locator("body").innerText());
    throw error;
  });
  console.log(JSON.stringify({ ...stats, pageErrors: errors, loadFailureAndRetry: "passed", output }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
