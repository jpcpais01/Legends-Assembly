import * as THREE from 'three';

/**
 * The Assembly Hall: the menu's own little world, so the home screen and hero select never show the battle map.
 *
 * A floating obsidian dais under a beam of light, a slowly turning gilded armillary halo behind the legend,
 * a ring of dark obelisks with glowing seams, and a painted nebula sky, all tinted by the selected legend's
 * colors. Everything is a handful of draw calls with cheap shaders: one shadowed spot light (the hero only),
 * no transparency sorting beyond a few additive layers, and no per-frame allocations.
 */
export class MenuStage {
  readonly scene = new THREE.Scene();
  /** Where the showcase hero stands (on top of the dais). */
  readonly heroPos = new THREE.Vector3(0, 0.3, 0);

  private uni = {
    uTime: { value: 0 },
    uC: { value: new THREE.Color('#ffcf5a') },
    uA: { value: new THREE.Color('#ff8a3d') },
    uBurst: { value: 0 },
    uWave: { value: 9 },
  };
  private wantC = new THREE.Color('#ffcf5a');
  private wantA = new THREE.Color('#ff8a3d');
  private rings: THREE.Object3D[] = [];
  private halo = new THREE.Group();
  private key: THREE.SpotLight;
  private rimL: THREE.DirectionalLight;
  private rimR: THREE.DirectionalLight;
  private glow: THREE.PointLight;
  private seamMat: THREE.MeshBasicMaterial;
  private haloMat!: THREE.MeshStandardMaterial;
  private t = 0;

  constructor(gl: THREE.WebGLRenderer) {
    const s = this.scene;
    s.fog = new THREE.FogExp2(0x05060d, 0.045);
    s.environment = buildEnv(gl);
    s.environmentIntensity = 0.4;

    // ── lights ──
    s.add(new THREE.HemisphereLight(0x8a9cff, 0x0b0705, 0.35));
    const key = new THREE.SpotLight(0xfff1dc, 420, 30, 0.42, 0.7, 2);
    key.position.set(-2.4, 8.5, -3.6);
    key.target.position.copy(this.heroPos).setY(1.1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 16;
    s.add(key, key.target);
    this.key = key;
    this.rimL = new THREE.DirectionalLight(0xffffff, 3.2);
    this.rimL.position.set(-4, 3.5, 5);
    this.rimR = new THREE.DirectionalLight(0xffffff, 2.6);
    this.rimR.position.set(4.5, 2.5, 4);
    s.add(this.rimL, this.rimR);
    this.glow = new THREE.PointLight(0xffffff, 18, 9, 2);
    this.glow.position.set(0, 1.8, 2.6);
    s.add(this.glow);

    s.add(this.sky(), this.floor(), this.floorLines());
    this.dais();
    this.buildHalo();
    this.seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, toneMapped: false });
    this.obelisks();
    s.add(this.beams(), this.motes());
    // contact shadow under the hero, always (cheap and grounds them even without the shadow map)
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec2 vU; void main(){ float r = length(vU - .5) * 2.; gl_FragColor = vec4(0.,0.,0., .55 * pow(1. - clamp(r,0.,1.), 2.)); }',
    }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, this.heroPos.y + 0.004, 0);
    s.add(blob);
  }

  /** Tint the whole hall for a legend. Colors ease over about half a second. */
  setHero(color: string, accent: string) {
    this.wantC.set(color);
    this.wantA.set(accent);
  }

  /** Lock-in flare: the halo flashes, a ring wave runs across the floor and the key light spikes. */
  burst() {
    this.uni.uBurst.value = 1;
    this.uni.uWave.value = 0;
  }

  update(dt: number) {
    this.t += dt;
    const u = this.uni;
    u.uTime.value = this.t;
    const k = 1 - Math.exp(-dt * 5);
    u.uC.value.lerp(this.wantC, k);
    u.uA.value.lerp(this.wantA, k);
    u.uBurst.value = Math.max(0, u.uBurst.value - dt * 1.4);
    u.uWave.value = Math.min(9, u.uWave.value + dt * 1.1);
    const b = u.uBurst.value;
    this.rings[0].rotation.z += dt * 0.08;
    this.rings[1].rotation.y += dt * 0.11;
    this.rings[2].rotation.x += dt * 0.07;
    this.rings[3].rotation.z -= dt * 0.16;
    this.halo.position.y = 1.75 + Math.sin(this.t * 0.6) * 0.06;
    (this.scene.fog as THREE.FogExp2).color.setRGB(0.012, 0.014, 0.026).lerp(u.uC.value, 0.035);
    this.rimL.color.copy(u.uC.value);
    this.rimR.color.copy(u.uA.value);
    this.glow.color.copy(u.uC.value);
    this.glow.intensity = 16 + b * 60;
    this.key.intensity = 420 + b * 300;
    this.seamMat.color.copy(u.uC.value).multiplyScalar(1.1 + b * 2);
    this.haloMat.emissive.copy(u.uC.value);
    this.haloMat.emissiveIntensity = 2.4 + b * 5;
  }

  // ───────────────────────── pieces ─────────────────────────

  private sky() {
    const m = new THREE.ShaderMaterial({
      uniforms: this.uni, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uC; uniform vec3 uA; uniform float uBurst; varying vec3 vD;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
        void main(){
          vec3 d = normalize(vD);
          float h = d.y;
          vec3 col = mix(vec3(.003,.004,.009), vec3(.009,.011,.024), smoothstep(-.15, .7, h));
          // painted nebula: domain-warped swirls, densest behind the stage
          vec2 p = vec2(atan(d.x, d.z) * 1.5, h * 2.4);
          vec2 w = vec2(fbm(p * 1.4 + uTime * .012), fbm(p * 1.4 - uTime * .01 + 3.7));
          float n = fbm(p * 1.1 + w * 2.2 + vec2(uTime * .006, 0.));
          float back = smoothstep(-.6, 1., d.z) * smoothstep(-.25, .35, h);
          vec3 neb = mix(uA, uC, smoothstep(.3, .75, n)) * pow(smoothstep(.4, .95, n), 2.6) * .2 * back;
          // a brushed streak of light along the horizon
          neb += uC * exp(-pow((h - .08) * 9., 2.)) * .06 * back;
          // the halo sun behind the armillary
          float g = max(dot(d, normalize(vec3(0., .2, 1.))), 0.);
          vec3 glow = mix(uA, uC, .6) * (pow(g, 40.) * (.7 + uBurst * 1.5) + pow(g, 8.) * .05);
          // stars
          vec2 sp = p * 60.;
          float st = h21(floor(sp));
          float star = step(.985, st) * smoothstep(.45, 0., length(fract(sp) - .5)) * (.5 + .5 * sin(uTime * 2. + st * 60.));
          col += neb + glow + vec3(star) * .55 * smoothstep(0., .3, h);
          gl_FragColor = vec4(col, 1.);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), m);
    sky.renderOrder = 10; // after the opaques, so early-Z skips the pixels the stage covers
    sky.frustumCulled = false;
    return sky;
  }

  private floor() {
    const m = new THREE.MeshStandardMaterial({ color: 0x06070b, roughness: 0.42, metalness: 0.3 });
    const f = new THREE.Mesh(new THREE.CircleGeometry(60, 64), m);
    f.rotation.x = -Math.PI / 2;
    f.receiveShadow = true;
    return f;
  }

  /** Engraved light on the floor: concentric rings, a ticked dial, a rotating dashed orbit and the lock-in wave. */
  private floorLines() {
    const m = new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `varying vec2 vP; void main(){ vP = (modelMatrix * vec4(position, 1.)).xz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uC; uniform vec3 uA; uniform float uBurst; uniform float uWave; varying vec2 vP;
        float line(float d, float w){ float fw = fwidth(d) * 1.2; return 1. - smoothstep(w, w + fw, abs(d)); }
        void main(){
          float r = length(vP);
          float a = atan(vP.y, vP.x) / 6.2831853 + .5;
          float l = 0.;
          l += line(r - 2.75, .012) * .9;
          l += line(r - 3.05, .006) * .5;
          l += line(r - 4.4, .01) * .55 * step(.5, fract(a * 36. + uTime * .02));
          l += line(r - 6.2, .008) * .35;
          l += line(r - 9.5, .008) * .22;
          // dial ticks between the two inner rings
          float tk = abs(fract(a * 120.) - .5) * 2.;
          l += smoothstep(.8, .9, tk) * step(2.78, r) * step(r, 3.02) * .45;
          // radial spokes, very faint
          l += line(fract(a * 8.) - .5, .002 * r) * smoothstep(3.1, 3.4, r) * smoothstep(9.5, 5., r) * .12;
          vec3 col = mix(uC, vec3(1., .86, .55), .35) * l;
          // pool of light under the beam
          col += mix(uC, vec3(1.), .5) * exp(-r * r * .45) * .1;
          // lock-in wave
          col += uC * line(r - uWave * 2.2, .05 + uWave * .02) * (1. - uWave / 9.) * 2.;
          col *= smoothstep(13., 3., r) * (1. + uBurst * 1.2);
          gl_FragColor = vec4(col, 1.);
        }`,
    });
    const f = new THREE.Mesh(new THREE.CircleGeometry(13, 96), m);
    f.rotation.x = -Math.PI / 2;
    f.position.y = 0.012;
    f.renderOrder = 2;
    return f;
  }

  private dais() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x0c0d14, roughness: 0.45, metalness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a650, roughness: 0.22, metalness: 1 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.82, 0.22, 72), stone);
    top.position.y = 0.19;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.7, 0.1, 72), stone);
    base.position.y = 0.05;
    for (const m of [top, base]) { m.receiveShadow = true; this.scene.add(m); }
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.025, 8, 96), gold);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.3;
    const lip2 = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.018, 8, 96), gold);
    lip2.rotation.x = Math.PI / 2;
    lip2.position.y = 0.1;
    this.scene.add(lip, lip2);
    // a band of light running around the dais side
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.79, 1.79, 0.035, 96, 1, true), new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform float uTime; uniform vec3 uC; uniform float uBurst; varying vec2 vU;
        void main(){ float run = pow(.5 + .5 * sin(vU.x * 6.2831 * 3. - uTime * 1.6), 6.);
          gl_FragColor = vec4(uC * (.9 + run * 2.2 + uBurst * 3.), 1.); }`,
    }));
    band.position.y = 0.16;
    this.scene.add(band);
  }

  /** A gilded armillary halo behind the legend: four rings on different axes, one glowing in the hero color. */
  private buildHalo() {
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b060, roughness: 0.25, metalness: 1 });
    this.haloMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.4, metalness: 0, emissive: 0xffffff, emissiveIntensity: 2.4 });
    const ring = (r: number, t: number, mat: THREE.Material) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 160), mat);
    const r0 = ring(2.55, 0.035, gold);
    const r1 = ring(2.2, 0.022, gold);
    const r2 = ring(2.85, 0.016, gold);
    const r3 = ring(2.4, 0.012, this.haloMat);
    r1.rotation.x = 0.5;
    r2.rotation.y = 0.9;
    r3.rotation.x = Math.PI / 2 - 0.25;
    // the main ring carries a dial of ticks (one instanced draw)
    const tickGeo = new THREE.BoxGeometry(0.02, 0.16, 0.03);
    const ticks = new THREE.InstancedMesh(tickGeo, gold, 72);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
      sc.set(1, i % 6 === 0 ? 1.9 : 1, 1);
      mm.compose(new THREE.Vector3(Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0), q, sc);
      ticks.setMatrixAt(i, mm);
    }
    r0.add(ticks);
    this.rings = [r0, r1, r2, r3];
    this.halo.add(r0, r1, r2, r3);
    // the glow disc behind the rings
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform vec3 uC; uniform vec3 uA; uniform float uBurst; uniform float uTime; varying vec2 vU;
        void main(){ vec2 p = vU - .5; float r = length(p) * 2.;
          float core = exp(-r * r * 9.) * .12 + exp(-r * r * 2.2) * .03;
          float ring = exp(-pow((r - .57) * 18., 2.)) * .22;
          float rays = pow(.5 + .5 * sin(atan(p.y, p.x) * 18. + uTime * .2), 8.) * exp(-r * 3.) * .12;
          vec3 c = mix(uA, uC, .55) * (core + ring + rays) * (1. + uBurst * 2.) * smoothstep(1., .7, r);
          gl_FragColor = vec4(c, 1.); }`,
    }));
    disc.position.z = 0.6;
    disc.name = 'disc';
    disc.renderOrder = 3;
    this.halo.add(disc);
    this.halo.position.set(0, 1.75, 3.1);
    this.scene.add(this.halo);
  }

  /** Dark obelisks in a wide arc behind the stage, each split by a glowing seam. Two instanced draws. */
  private obelisks() {
    const N = 11;
    const stone = new THREE.MeshStandardMaterial({ color: 0x090a0f, roughness: 0.78, metalness: 0.1 });
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stone, N);
    const seam = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.seamMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const a = (t - 0.5) * Math.PI * 1.25; // arc centred on +z (behind the hero)
      const R = 11 + Math.abs(t - 0.5) * 2.5;
      const h = 9 + Math.sin(i * 2.3) * 2.2 + (1 - Math.abs(t - 0.5) * 2) * 3;
      const w = 1.1 + (i % 3) * 0.2;
      p.set(Math.sin(a) * R, h / 2 - 0.5, Math.cos(a) * R);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      m.compose(p, q, s.set(w, h, w));
      body.setMatrixAt(i, m);
      p.set(Math.sin(a) * (R - w / 2 - 0.01), h / 2 - 0.5, Math.cos(a) * (R - w / 2 - 0.01));
      m.compose(p, q, s.set(0.05, h * 0.92, 0.02));
      seam.setMatrixAt(i, m);
    }
    body.name = 'obelisks'; seam.name = 'seams';
    this.scene.add(body, seam);
  }

  /** Soft volumetric beams falling on the dais: additive cones with a view-angle falloff and drifting dust. */
  private beams() {
    const m = new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vY = uv.y;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uC; uniform float uBurst; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
        void main(){ float edge = pow(abs(dot(normalize(vN), vV)), 2.5);
          float dust = .75 + .25 * sin(vW.y * 3.1 - uTime * .7 + sin(vW.x * 2. + uTime * .3) * 2.);
          float a = edge * smoothstep(0., .35, vY) * smoothstep(1., .55, vY) * dust;
          gl_FragColor = vec4(mix(vec3(1., .93, .82), uC, .3) * a * (.028 + uBurst * .08), 1.); }`,
    });
    const g = new THREE.Group();
    const cone = new THREE.ConeGeometry(1.9, 10, 40, 1, true);
    cone.translate(0, -5, 0);
    const main = new THREE.Mesh(cone, m);
    main.position.set(-1.2, 10.2, -1.8);
    main.lookAt(0, 0, 0);
    main.rotateX(-Math.PI / 2);
    g.add(main);
    const side = new THREE.Mesh(new THREE.ConeGeometry(1.2, 10, 32, 1, true).translate(0, -5, 0), m);
    side.position.set(2.6, 10, 2.5);
    side.lookAt(0.4, 0, 0.6);
    side.rotateX(-Math.PI / 2);
    g.add(side);
    g.renderOrder = 4;
    g.name = 'beams';
    return g;
  }

  /** Embers drifting up through the light. One draw, animated entirely in the vertex shader. */
  private motes() {
    const N = 520;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.pow(Math.random(), 0.7) * 7;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 7; pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `uniform float uTime; attribute float seed; varying float vA; varying float vS;
        void main(){ vec3 p = position; float sp = .12 + seed * .25;
          p.y = mod(p.y + uTime * sp, 7.);
          p.x += sin(uTime * .4 + seed * 30.) * .35; p.z += cos(uTime * .33 + seed * 20.) * .35;
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          // fade out anything drifting close to the lens, and keep sprites small (fill rate)
          vA = smoothstep(0., 1., p.y) * smoothstep(7., 4.5, p.y) * (.4 + .6 * fract(seed * 7.3)) * smoothstep(1.8, 3.2, -mv.z);
          vS = seed;
          gl_PointSize = min((1. + seed * 1.8) * (80. / -mv.z), 12.);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uC; uniform float uBurst; varying float vA; varying float vS;
        void main(){ float d = length(gl_PointCoord - .5) * 2.; float a = pow(max(0., 1. - d), 2.) * vA;
          gl_FragColor = vec4(mix(uC, vec3(1., .85, .5), step(.6, vS)) * a * (1.2 + uBurst * 2.), 1.); }`,
    });
    const pts = new THREE.Points(geo, m);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    return pts;
  }
}

/** A tiny studio for reflections: dark room, a big warm softbox overhead and two cool strip lights. Baked once. */
function buildEnv(gl: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0x0a0b12, side: THREE.BackSide }));
  env.add(room);
  const panel = (w: number, h: number, c: number, i: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide }));
    p.position.set(x, y, z); p.rotation.set(rx, ry, 0);
    env.add(p);
  };
  panel(8, 8, 0xfff1dc, 3, 0, 5.9, -2, 0, Math.PI / 2);
  panel(2, 8, 0x9fb6ff, 1.6, -9.9, 2, 3, Math.PI / 2);
  panel(2, 8, 0xffb37a, 1.3, 9.9, 2, 3, -Math.PI / 2);
  panel(10, 1.5, 0xffffff, 0.6, 0, 1, 9.9, Math.PI);
  const pm = new THREE.PMREMGenerator(gl);
  const rt = pm.fromScene(env, 0.03);
  pm.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}
