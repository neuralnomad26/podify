"use client";

import { useEffect, useRef } from "react";

/**
 * Full-viewport WebGL backdrop: a research paper that turns into a record.
 *
 * Every particle has two homes: a spot on a printed page (title, lines of text,
 * a small chart) and a spot in the grooves of a vinyl record. The page peels
 * away line by line from the top, the particles swirl up and around, and settle
 * into a record that spins and ripples like sound.
 *
 * - At the top of the page the transformation loops by itself.
 * - Scrolling, or pressing play on any episode, holds it as the record.
 * - The camera leans with the pointer and travels as the page scrolls.
 * - No WebGL, a weak device, or "reduce motion" means it never starts and the CSS backdrop stays.
 */

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpin;
  uniform float uAmp;
  uniform float uMorph;
  uniform float uScatter;
  uniform float uPixelRatio;
  attribute vec3 aPaper;
  attribute float aRadius;
  attribute float aAngle;
  attribute float aSeed;
  attribute float aSize;
  attribute float aInk;
  varying float vRadius;
  varying float vHeat;
  varying float vSeed;
  varying float vMix;
  varying float vInk;

  void main() {
    // Each particle leaves the page at its own moment: top lines first, like a page being fed in.
    float delay = (1.0 - (aPaper.y + 2.0) / 4.0) * 0.55 + aSeed * 0.07;
    float m = smoothstep(delay, delay + 0.38, uMorph);

    // ---- home 1: the page, facing the viewer, with a slow paper curl
    vec3 page = aPaper;
    page.z += sin(page.y * 1.3 + uTime * 0.9) * 0.07 + sin(page.x * 2.1 + uTime * 0.7) * 0.03;

    // ---- home 2: the record, lying flat, grooves turning
    float ang = aAngle + uSpin * (0.55 + 0.45 * (1.0 - aRadius));
    float r = aRadius * 4.2;
    float ripple = sin(r * 3.4 - uTime * 2.4 + aSeed * 0.8) * 0.6 + sin(ang * 5.0 + uTime * 1.2) * 0.4;
    float y = ripple * (0.05 + uAmp * 0.34) * smoothstep(0.30, 1.0, aRadius);
    float slice = floor(ang * 24.0 / 6.28318);
    float bar = pow(abs(sin(ang * 12.0)), 10.0) * (0.5 + 0.5 * sin(uTime * 3.2 + slice * 1.9));
    float rim = smoothstep(0.84, 1.0, aRadius);
    y += bar * rim * (0.12 + uAmp * 1.25);
    vec3 disc = vec3(cos(ang) * r, y, sin(ang) * r);
    vec3 drift = vec3(sin(aSeed * 12.9898), cos(aSeed * 78.233), sin(aSeed * 37.719));
    disc += drift * uScatter * (0.6 + aRadius * 1.8);

    // ---- the flight between them: lift off, swirl around the centre, settle
    float arc = sin(m * 3.14159);
    vec3 p = mix(page, disc, m);
    p.y += arc * (0.7 + aSeed * 1.5);
    float turn = arc * (1.2 + aSeed * 2.4);
    float c = cos(turn), s = sin(turn);
    p.xz = mat2(c, -s, s, c) * p.xz;
    p += drift * arc * 0.35;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float discSize = aSize * (1.0 + uAmp * 0.35 + bar * rim * 1.4);
    float pageSize = 0.75 + aInk * 0.75;
    gl_PointSize = mix(pageSize, discSize, m) * uPixelRatio * (30.0 / -mv.z) * (1.0 + arc * 0.6);

    vRadius = aRadius;
    vHeat = clamp(abs(y) * 2.2 + bar * rim, 0.0, 1.0) * m + arc * 0.5;
    vSeed = aSeed;
    vMix = m;
    vInk = aInk;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  varying float vRadius;
  varying float vHeat;
  varying float vSeed;
  varying float vMix;
  varying float vInk;

  void main() {
    // Soft round sprite with a hot core: additive blending turns overlap into glow.
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = pow(smoothstep(0.5, 0.0, d), 2.2);

    vec3 violet = vec3(0.545, 0.361, 0.965);
    vec3 fuchsia = vec3(0.925, 0.282, 0.600);
    vec3 amber = vec3(0.976, 0.451, 0.086);
    vec3 cyan = vec3(0.133, 0.827, 0.933);

    // The page: cool white ink on a faint lilac sheet.
    vec3 paper = mix(vec3(0.62, 0.55, 0.95), vec3(0.96, 0.94, 1.0), vInk);
    float paperAlpha = mix(0.10, 0.62, vInk);

    // The record: label in the middle, grooves outside, cyan catching the rim.
    vec3 groove = mix(violet, fuchsia, smoothstep(0.30, 0.95, vRadius));
    vec3 label = mix(amber, fuchsia, smoothstep(0.06, 0.30, vRadius));
    vec3 disc = mix(label, groove, smoothstep(0.28, 0.34, vRadius));
    disc = mix(disc, cyan, smoothstep(0.93, 1.0, vRadius) * 0.55);

    vec3 color = mix(paper, disc, vMix) + vec3(1.0, 0.85, 0.95) * vHeat * 0.55;
    float twinkle = mix(1.0, 0.75 + 0.25 * sin(uTime * 2.0 + vSeed * 40.0), vMix);
    gl_FragColor = vec4(color, alpha * uOpacity * twinkle * mix(paperAlpha, 1.0, vMix));
  }
`;

type Seg = { x0: number; x1: number; y: number; thick: number; ink: number };

/** Lays out a printed page as line segments: title, authors, abstract, body text, a bar chart, a border. */
function pageLayout(rand: () => number): { segs: Seg[]; total: number } {
  const segs: Seg[] = [];
  const W = 1.5, H = 2.0, M = 0.26; // half width, half height, margin
  const words = (x0: number, x1: number, y: number, thick: number, ink: number) => {
    let x = x0;
    while (x < x1 - 0.05) {
      const len = Math.min(0.07 + rand() * 0.26, x1 - x);
      segs.push({ x0: x, x1: x + len, y, thick, ink });
      x += len + 0.045;
    }
  };
  // Title (two heavy lines), authors, rule
  words(-0.95, 0.95, 1.62, 0.03, 1);
  words(-0.7, 0.7, 1.46, 0.03, 1);
  words(-0.55, 0.55, 1.27, 0.012, 0.6);
  segs.push({ x0: -W + M, x1: W - M, y: 1.14, thick: 0.004, ink: 0.5 });
  // Abstract: indented block
  for (let i = 0; i < 5; i++) words(-W + M + 0.22, i === 4 ? 0.3 : W - M - 0.22, 0.98 - i * 0.105, 0.011, 0.85);
  // Body: full width, except where the figure sits on the right
  const figTop = -0.02, figBottom = -1.0, figLeft = 0.1;
  let line = 0;
  for (let y = 0.34; y > -H + M; y -= 0.105, line++) {
    const beside = y < figTop + 0.05 && y > figBottom - 0.05;
    const paragraphEnd = line % 7 === 6;
    words(-W + M, beside ? figLeft - 0.14 : paragraphEnd ? 0.2 : W - M, y, 0.011, 0.85);
  }
  // Figure: frame, baseline, five bars
  const fx0 = figLeft, fx1 = W - M;
  segs.push({ x0: fx0, x1: fx1, y: figTop, thick: 0.004, ink: 0.5 }, { x0: fx0, x1: fx1, y: figBottom, thick: 0.004, ink: 0.5 });
  [0.35, 0.6, 0.45, 0.9, 0.7].forEach((h, i) => {
    const bx = fx0 + 0.12 + i * ((fx1 - fx0 - 0.24) / 5);
    const top = figBottom + 0.1 + h * 0.75;
    for (let y = figBottom + 0.1; y < top; y += 0.022) segs.push({ x0: bx, x1: bx + 0.12, y, thick: 0.01, ink: 1 });
  });
  // Border and a faint sheet
  segs.push({ x0: -W, x1: W, y: H, thick: 0.006, ink: 0.7 }, { x0: -W, x1: W, y: -H, thick: 0.006, ink: 0.7 });
  for (let y = -H; y < H; y += 0.02) {
    segs.push({ x0: -W, x1: -W + 0.012, y, thick: 0.01, ink: 0.7 }, { x0: W - 0.012, x1: W, y, thick: 0.01, ink: 0.7 });
  }
  for (let y = -H + 0.03; y < H; y += 0.06) segs.push({ x0: -W, x1: W, y, thick: 0.03, ink: 0.0 });

  // Ink gets more particles per unit length than the blank sheet.
  let total = 0;
  for (const s of segs) total += (s.x1 - s.x0) * (s.ink > 0 ? 1 : 0.22);
  return { segs, total };
}

export default function Scene3D() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const weak = (navigator.hardwareConcurrency ?? 8) <= 2;
    if (reduced || weak) return;

    let disposed = false;
    let cleanup = () => {};

    import("three")
      .then((THREE) => {
        if (disposed) return;

        let renderer: import("three").WebGLRenderer;
        try {
          renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
        } catch {
          return; // no WebGL: the CSS backdrop stays
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
        renderer.setPixelRatio(dpr);
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        // A long lens flattens the subject and makes it feel large and expensive.
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
        const subject = new THREE.Group();
        scene.add(subject);

        // ------------------------------------------------------ the particles
        const mobile = window.innerWidth < 768;
        const COUNT = mobile ? 28000 : 72000;
        const GROOVES = 46;
        const paper = new Float32Array(COUNT * 3);
        const radius = new Float32Array(COUNT);
        const angle = new Float32Array(COUNT);
        const seed = new Float32Array(COUNT);
        const size = new Float32Array(COUNT);
        const ink = new Float32Array(COUNT);
        const position = new Float32Array(COUNT * 3); // unused by the shader, required by three

        // Deterministic pseudo-random numbers, so it looks the same on every visit.
        let s = 1337;
        const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

        const { segs, total } = pageLayout(rand);
        const cumulative: number[] = [];
        let acc = 0;
        for (const g of segs) cumulative.push((acc += ((g.x1 - g.x0) * (g.ink > 0 ? 1 : 0.22)) / total));

        for (let i = 0; i < COUNT; i++) {
          // Home on the page: pick a segment in proportion to its length.
          const u = rand();
          let lo = 0, hi = cumulative.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cumulative[mid] < u) lo = mid + 1;
            else hi = mid;
          }
          const g = segs[lo];
          paper[i * 3] = g.x0 + rand() * (g.x1 - g.x0);
          paper[i * 3 + 1] = g.y + (rand() - 0.5) * g.thick;
          paper[i * 3 + 2] = (rand() - 0.5) * 0.01;
          ink[i] = g.ink;

          // Home on the record.
          const pick = rand();
          let r: number;
          if (pick < 0.16) r = 0.07 + rand() * 0.22; // label
          else if (pick < 0.2) r = 0.985 + rand() * 0.015; // bright rim
          else r = 0.34 + (Math.floor(rand() * GROOVES) / GROOVES) * 0.64 + (rand() - 0.5) * 0.006; // tight groove rings
          radius[i] = r;
          angle[i] = rand() * Math.PI * 2;
          seed[i] = rand();
          size[i] = r < 0.3 ? 1.5 + rand() * 1.6 : 0.9 + rand() * 1.5;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
        geometry.setAttribute("aPaper", new THREE.BufferAttribute(paper, 3));
        geometry.setAttribute("aRadius", new THREE.BufferAttribute(radius, 1));
        geometry.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
        geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
        geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
        geometry.setAttribute("aInk", new THREE.BufferAttribute(ink, 1));
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

        const uniforms = {
          uTime: { value: 0 },
          uSpin: { value: 0 },
          uAmp: { value: 0.15 },
          uMorph: { value: 0 },
          uScatter: { value: 0 },
          uOpacity: { value: 0 },
          uPixelRatio: { value: dpr },
        };
        const material = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        subject.add(points);

        // ---------------------------------------------------------------- dust
        const DUST = mobile ? 500 : 1400;
        const dustPos = new Float32Array(DUST * 3);
        for (let i = 0; i < DUST; i++) {
          dustPos[i * 3] = (rand() - 0.5) * 26;
          dustPos[i * 3 + 1] = (rand() - 0.5) * 14;
          dustPos[i * 3 + 2] = (rand() - 0.5) * 22;
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
        const dustMat = new THREE.PointsMaterial({ color: 0xd8b4fe, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
        const dust = new THREE.Points(dustGeo, dustMat);
        scene.add(dust);

        // -------------------------------------------------------- choreography
        // Camera stops along the page: scroll position, camera, look-at, subject x, scatter.
        const wide = () => window.innerWidth >= 1024;
        const stops = () => {
          const offset = wide() ? 3.3 : 0; // the hero keeps its right half clear for this
          return [
            // `size` is how large the record is; `dim` is how bright the scene is behind the content.
            { t: 0.0, cam: [0, 1.7, 12.5], look: [0, 0.15, 0], x: offset, scatter: 0.0, size: wide() ? 0.6 : 0.7, dim: 0.9 },
            { t: 0.22, cam: [-1.2, 2.6, 10.0], look: [0, 0, 0], x: offset * 0.35, scatter: 0.04, size: 0.85, dim: 0.4 },
            { t: 0.6, cam: [1.6, 0.8, 6.6], look: [0, 0.1, 0], x: 0, scatter: 0.3, size: 1, dim: 0.34 },
            { t: 1.0, cam: [0, 11.5, 2.4], look: [0, 0, 0], x: 0, scatter: 0.1, size: 1, dim: 0.5 },
          ];
        };
        let path = stops();

        const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
        const ease = (k: number) => k * k * (3 - 2 * k);
        const sample = (t: number) => {
          let i = 0;
          while (i < path.length - 2 && t > path[i + 1].t) i++;
          const a = path[i], b = path[i + 1];
          const k = ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
          return {
            cam: a.cam.map((v, j) => lerp(v, b.cam[j], k)),
            look: a.look.map((v, j) => lerp(v, b.look[j], k)),
            x: lerp(a.x, b.x, k),
            scatter: lerp(a.scatter, b.scatter, k),
            size: lerp(a.size, b.size, k),
            dim: lerp(a.dim, b.dim, k),
          };
        };

        // The loop at the top of the page: page, peel into record, record, back to page.
        const LOOP = 12.5;
        const autoMorph = (time: number) => {
          const t = time % LOOP;
          if (t < 2.6) return 0;
          if (t < 6.4) return (t - 2.6) / 3.8;
          if (t < 10.2) return 1;
          return 1 - ease((t - 10.2) / 2.3);
        };

        const state = { scroll: 0, mx: 0, my: 0, amp: 0.15, spinSpeed: 0.22, playing: false, morph: 0 };
        const cur = { ...sample(0), mx: 0, my: 0 };
        const look = new THREE.Vector3();

        const onScroll = () => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          state.scroll = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        };
        const onMouse = (e: MouseEvent) => {
          state.mx = (e.clientX / window.innerWidth - 0.5) * 2;
          state.my = (e.clientY / window.innerHeight - 0.5) * 2;
        };
        const onResize = () => {
          const w = window.innerWidth, h = window.innerHeight;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          path = stops();
        };
        // The record reacts to real playback anywhere on the page.
        const onAudio = () => {
          state.playing = Array.from(document.querySelectorAll("audio")).some((a) => !a.paused && !a.ended);
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("mousemove", onMouse, { passive: true });
        window.addEventListener("resize", onResize);
        document.addEventListener("play", onAudio, true);
        document.addEventListener("pause", onAudio, true);
        document.addEventListener("ended", onAudio, true);
        onResize();
        onScroll();

        const root = document.documentElement;
        const clock = new THREE.Clock();
        let raf = 0;
        let running = true;

        const frame = () => {
          if (!running) return;
          const dt = Math.min(clock.getDelta(), 0.05);
          const time = clock.elapsedTime;

          // Everything eases towards its target: nothing ever jumps.
          const target = sample(state.scroll);
          const k = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing
          for (let j = 0; j < 3; j++) {
            cur.cam[j] = lerp(cur.cam[j], target.cam[j], k * 0.55);
            cur.look[j] = lerp(cur.look[j], target.look[j], k * 0.55);
          }
          cur.x = lerp(cur.x, target.x, k * 0.55);
          cur.scatter = lerp(cur.scatter, target.scatter, k * 0.55);
          cur.size = lerp(cur.size, target.size, k * 0.55);
          cur.dim = lerp(cur.dim, target.dim, k * 0.55);
          cur.mx = lerp(cur.mx, state.mx, k * 0.4);
          cur.my = lerp(cur.my, state.my, k * 0.4);

          // Paper or record? Loop at the top; hold the record once the visitor scrolls or presses play.
          const hold = state.playing || state.scroll > 0.1;
          state.morph = lerp(state.morph, hold ? 1 : autoMorph(time), hold ? k * 0.35 : k * 0.9);
          state.amp = lerp(state.amp, state.playing ? 1 : 0.15, k * 0.35);
          state.spinSpeed = lerp(state.spinSpeed, state.playing ? 1.35 : 0.22, k * 0.3);

          uniforms.uTime.value = time;
          uniforms.uSpin.value += state.spinSpeed * dt;
          uniforms.uAmp.value = state.amp;
          uniforms.uMorph.value = state.morph;
          uniforms.uScatter.value = cur.scatter;
          // Fade in on load, stay bright in the hero, and step back behind the content below it.
          const o = uniforms.uOpacity.value;
          uniforms.uOpacity.value = o < cur.dim ? Math.min(cur.dim, o + dt * 0.6) : Math.max(cur.dim, o - dt * 1.2);
          // Lets the page label the transformation ("paper" → "podcast").
          root.style.setProperty("--morph", state.morph.toFixed(3));

          // The page stands up and faces you; the record lies back.
          // The page keeps its size; the record is drawn smaller in the hero so it never crowds the headline.
          subject.scale.setScalar(lerp(1, cur.size, state.morph));
          subject.position.x = cur.x;
          subject.position.y = Math.sin(time * 0.5) * 0.08;
          subject.rotation.x = lerp(0.04, 0.42, state.morph) + cur.my * 0.07;
          subject.rotation.y = lerp(-0.28, 0, state.morph) + cur.mx * 0.12;
          subject.rotation.z = -cur.mx * 0.04;

          camera.position.set(cur.cam[0] + cur.mx * 0.55, cur.cam[1] - cur.my * 0.3, cur.cam[2]);
          look.set(cur.look[0] + cur.x * 0.35, cur.look[1], cur.look[2]);
          camera.lookAt(look);

          dust.rotation.y = time * 0.012;
          dust.position.y = -state.scroll * 2.2;

          renderer.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };

        const onVisibility = () => {
          running = !document.hidden;
          if (running) {
            clock.getDelta();
            raf = requestAnimationFrame(frame);
          } else cancelAnimationFrame(raf);
        };
        document.addEventListener("visibilitychange", onVisibility);
        root.classList.add("has-3d");
        raf = requestAnimationFrame(frame);

        cleanup = () => {
          running = false;
          cancelAnimationFrame(raf);
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("mousemove", onMouse);
          window.removeEventListener("resize", onResize);
          document.removeEventListener("play", onAudio, true);
          document.removeEventListener("pause", onAudio, true);
          document.removeEventListener("ended", onAudio, true);
          document.removeEventListener("visibilitychange", onVisibility);
          root.classList.remove("has-3d");
          root.style.removeProperty("--morph");
          geometry.dispose();
          material.dispose();
          dustGeo.dispose();
          dustMat.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
        if (disposed) cleanup();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={host} className="scene3d" aria-hidden />;
}

/** A small dot that trails the pointer and swells over anything clickable. Fine pointers only. */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dot.current;
    if (!el || !window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let x = -100, y = -100, tx = -100, ty = -100, raf = 0;
    const move = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      el.classList.add("on");
      el.classList.toggle("big", Boolean((e.target as Element | null)?.closest?.("a, button, input, [role=button], summary")));
    };
    const leave = () => el.classList.remove("on");
    const tick = () => {
      x += (tx - x) * 0.16;
      y += (ty - y) * 0.16;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, []);

  return <div ref={dot} className="cursor-dot" aria-hidden />;
}
