import * as THREE from "three";

/** Continuous cloud cover without precipitation or a photographic backdrop. */
export function createOvercastSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x76848e) },
      horizon: { value: new THREE.Color(0xbdc6cb) },
      cloudLight: { value: new THREE.Color(0xb4bdc4) },
      cloudShade: { value: new THREE.Color(0x667680) },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 cloudLight;
      uniform vec3 cloudShade;
      varying vec3 direction;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }
      float cloudNoise(vec2 p) {
        float sum = 0.0;
        float amplitude = 0.52;
        for (int octave = 0; octave < 5; octave++) {
          sum += noise(p) * amplitude;
          p = mat2(1.6, -1.2, 1.2, 1.6) * p + vec2(12.8, 7.3);
          amplitude *= 0.48;
        }
        return sum;
      }
      void main() {
        vec3 ray = normalize(direction);
        float height = max(ray.y, 0.0);
        vec2 uv = ray.xz / (height + 0.3);
        float broad = cloudNoise(uv * 2.4 + vec2(3.1, 7.4));
        float detail = cloudNoise(uv * 6.8 + vec2(21.0, 5.0));
        float density = smoothstep(0.22, 0.82, broad * 0.8 + detail * 0.2);
        vec3 base = mix(horizon, zenith, pow(height, 0.45));
        vec3 clouds = mix(cloudLight, cloudShade, density);
        vec3 color = mix(base, clouds, smoothstep(0.015, 0.3, height) * 0.88);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 20), material);
  sky.name = "overcast-cloud-deck";
  sky.frustumCulled = false;
  return sky;
}

/** Fine, matte aggregate shared by the recycled road segments. */
export function createDryAsphaltMaterial(maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la textura del asfalto.");
  const pixels = context.createImageData(256, 256);
  let seed = 9417;
  for (let index = 0; index < pixels.data.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = 76 + ((seed >>> 24) / 255 - 0.5) * 34;
    pixels.data[index] = grain;
    pixels.data[index + 1] = grain + 2;
    pixels.data[index + 2] = grain + 3;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 36);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return new THREE.MeshStandardMaterial({
    name: "dry-asphalt",
    color: 0xb8bab7,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.007,
    roughness: 0.96,
    metalness: 0,
  });
}
