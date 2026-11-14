import * as THREE from 'three';
import { getNoiseTexture } from '../render/textures';

export const SUN_DIR = new THREE.Vector3(0.32, 0.24, -0.92).normalize();

/** Shared GLSL for the golden-hour atmosphere so water/fog/sky agree. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
vec3 skyColor(vec3 dir) {
  float y = dir.y;
  float h = pow(1.0 - max(y, 0.0), 4.0);
  vec3 col = mix(uZenith, uHorizon, h);
  float sd = max(dot(dir, uSunDir), 0.0);
  // warm forward scattering around the sun
  col += uSunColor * (pow(sd, 6.0) * 0.45 + pow(sd, 48.0) * 1.1) * (0.35 + 0.65 * h);
  // pink-violet band opposite the sun
  float anti = max(dot(dir, -uSunDir), 0.0);
  col += vec3(0.35, 0.12, 0.35) * pow(anti, 3.0) * h * 0.25;
  // below horizon fades into the lake haze
  col = mix(col, uGround, smoothstep(0.0, -0.25, y));
  return col;
}
`;

export function skyUniforms() {
  return {
    uSunDir: { value: SUN_DIR.clone() },
    uZenith: { value: new THREE.Color(0.10, 0.20, 0.48) },
    uHorizon: { value: new THREE.Color(1.15, 0.66, 0.42) },
    uGround: { value: new THREE.Color(0.42, 0.36, 0.40) },
    uSunColor: { value: new THREE.Color(1.6, 0.9, 0.5) },
  };
}

export class Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor() {
    const noise = getNoiseTexture();
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        ...skyUniforms(), uTime: { value: 0 }, uNoise: { value: noise }, uCloudy: { value: 1 },
        // cloud bellies and sunlit edges (golden hour by default; the museum's noon sky sets its own)
        uCloudDark: { value: new THREE.Color(0.42, 0.32, 0.48) }, uCloudLit: { value: new THREE.Color(1.5, 0.82, 0.55) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // pin to far plane
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        uniform float uTime;
        uniform float uCloudy;
        uniform sampler2D uNoise;
        uniform vec3 uCloudDark, uCloudLit;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          vec3 col = skyColor(dir);
          float sd = max(dot(dir, uSunDir), 0.0);
          // sun disk (HDR, drives bloom)
          col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 18.0;
          // clouds projected onto a high plane
          if (dir.y > 0.0) {
            vec2 uv = dir.xz / (dir.y + 0.12);
            vec2 w = vec2(uTime * 0.0035, uTime * 0.0012);
            float n = texture2D(uNoise, uv * 0.11 + w).a * 0.6 + texture2D(uNoise, uv * 0.33 - w * 1.7).g * 0.4;
            float detail = texture2D(uNoise, uv * 1.2 + w * 3.0).r;
            float d = smoothstep(0.48, 0.78, n + (detail - 0.5) * 0.18) * uCloudy;
            float fade = smoothstep(0.0, 0.18, dir.y);
            d *= fade;
            // lit edges toward the sun, deep violet bellies
            float lit = pow(sd, 3.0);
            vec3 cloudCol = mix(uCloudDark, uCloudLit, 0.35 + 0.65 * lit);
            cloudCol += uSunColor * pow(sd, 20.0) * (1.0 - d) * 2.0; // silver lining
            col = mix(col, cloudCol, d * 0.85);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const geo = new THREE.SphereGeometry(900, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(time: number, cameraPos: THREE.Vector3) {
    this.material.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPos);
  }

  /** Bake image-based lighting from the sky (clouds frozen) — one PMREM at boot. */
  bakeEnvironment(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const clone = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.material.clone());
    (clone.material as THREE.ShaderMaterial).uniforms.uCloudy.value = 0.6;
    // warm ground bounce disk so IBL from below isn't black
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.24, 0.12) }),
    );
    ground.position.y = -2;
    s.add(clone, ground);
    const rt = pmrem.fromScene(s, 0.02, 0.1, 200);
    pmrem.dispose();
    return rt.texture;
  }
}
