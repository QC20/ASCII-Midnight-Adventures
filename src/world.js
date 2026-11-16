/* Dust & Signal — the mirror flats: terrain, fords, vegetation and everything standing on them. */
(function () {
  'use strict';
  const DS = window.DS, U = DS.util, MAT = DS.MAT;
  const TILT = (40 * Math.PI) / 180;
  const W = (DS.world = { TILT, S: Math.sin(TILT), K: Math.cos(TILT) });

  /* ---- layout (x east, z south, y up; the walk runs north, towards -z) ---- */
  W.map = { x0: -72, z0: -212, w: 144, h: 256, res: 2 };
  W.start = { x: 0, z: 7.7 };
  W.masts = [
    { x: 6, z: -6 },
    { x: -33, z: -38 },
    { x: 18, z: -73 },
    { x: -27, z: -111 },
  ];
  W.tower = { x: 10, z: -153 };
  W.MAST_H = 5.5;
  W.TOWER_H = 11.5;
  for (const m of W.masts) { m.ix = m.x; m.iz = m.z + 1.55; }
  W.tower.ix = W.tower.x; W.tower.iz = W.tower.z + 3.5;

  // leg k leads from mast k to mast k+1 (the last one to the tower)
  W.legs = [
    [[6, -4.4], [0, -13], [-11, -20], [-22, -28], [-33, -36.4]],
    [[-33, -36.4], [-26, -45], [-14, -50.5], [-3, -55], [5, -61], [13, -68], [18, -71.4]],
    [[18, -71.4], [13, -81], [2, -88], [-9, -95], [-18, -101], [-27, -109.4]],
    [[-27, -109.4], [-23, -119], [-12, -127], [-2, -135], [5, -143], [10, -149.4]],
  ];
  const WALK_IN = [[0, 3.4], [2.4, -0.6], [6, -4.4]];

  const ISLANDS = [
    // x, z, rx, rz, rot, height
    [2.5, -3.5, 11.5, 8.0, 0.2, 0.42], // the landing
    [-12.5, -20.5, 4.6, 3.6, -0.4, 0.3],
    [-33.5, -38.5, 6.6, 5.0, 0.3, 0.36], // the wreck
    [-15, -50.5, 5.0, 3.8, 0.5, 0.3],
    [3, -57.5, 4.2, 3.2, -0.2, 0.28],
    [17.5, -72.5, 14.5, 10.5, -0.15, 0.36], // the red flats
    [1, -88.5, 4.4, 3.2, 0.3, 0.28],
    [-13, -97.5, 3.6, 2.8, -0.5, 0.26],
    [-27.5, -110.5, 13.5, 9.5, 0.1, 0.38], // the salt works
    [-11, -127.5, 6.0, 3.4, 0.6, 0.28],
    [1.5, -138, 4.0, 3.0, -0.3, 0.26],
    [10, -153.5, 10.5, 8.5, 0.0, 0.46], // the tower
    // out of reach, for the horizon
    [31, -24, 5.5, 4, 0.4, 0.3], [-47, -72, 6.5, 4.5, -0.3, 0.3], [40, -112, 5.5, 4.2, 0.2, 0.3],
    [-38, -152, 5, 4, 0.5, 0.3], [27, 12, 4.5, 3.2, -0.2, 0.26], [-30, 4, 5, 3.5, 0.3, 0.28],
    [42, -64, 4, 3, 0, 0.26], [38, -150, 4.5, 3.5, 0.3, 0.28], [-52, -112, 5, 3.6, 0.2, 0.28],
  ].map((a, i) => ({ x: a[0], z: a[1], rx: a[2], rz: a[3], c: Math.cos(a[4]), s: Math.sin(a[4]), h: a[5], seed: 13.7 * (i + 1) }));

  // reed banks the route pushes straight through: x, z, rx, rz
  const REED_BANKS = [
    [2.6, 0.4, 3.4, 2.5], [-6, -15.5, 3.2, 2.4], [-20, -47.5, 5.2, 3.4], [9.5, -64.5, 4.0, 2.8],
    [-4, -91.5, 4.4, 2.8], [-17, -123, 5.0, 3.0], [3.5, -140.5, 3.6, 2.4],
  ];
  // glasswort, the red carpet: x, z, rx, rz
  const RED_BEDS = [[17.5, -72.5, 17, 12.5], [-22, -106.5, 5, 3.5], [-13, -97.5, 4, 3], [12, -160, 5, 3.5]];

  const SEGS = [];
  for (const leg of [WALK_IN, ...W.legs]) for (let i = 0; i + 1 < leg.length; i++) SEGS.push([leg[i][0], leg[i][1], leg[i + 1][0], leg[i + 1][1]]);
  function pathDist(x, z) {
    let d = 1e9;
    for (let i = 0; i < SEGS.length; i++) {
      const s = SEGS[i];
      const q = U.distSeg(x, z, s[0], s[1], s[2], s[3]);
      if (q < d) d = q;
    }
    return d;
  }
  W.pathDist = pathDist;

  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

  function rawElev(x, z) {
    let e = -1.75;
    const hw = 3.3 + 2.6 * U.fbm(x * 0.07 + 11, z * 0.07 - 3, 2);
    const ef = -0.17 - 1.58 * U.smoothstep(hw * 0.55, hw * 1.3, pathDist(x, z));
    e = Math.max(e, ef);
    for (let i = 0; i < ISLANDS.length; i++) {
      const I = ISLANDS[i];
      const dx = x - I.x, dz = z - I.z;
      if (Math.abs(dx) > I.rx * 2.6 + 4 || Math.abs(dz) > I.rz * 2.6 + 4) continue;
      const xr = (dx * I.c + dz * I.s) / I.rx, zr = (-dx * I.s + dz * I.c) / I.rz;
      let d = Math.sqrt(xr * xr + zr * zr);
      d += (U.fbm(x * 0.19 + I.seed, z * 0.19 - I.seed * 0.7, 3) - 0.5) * 0.5;
      e = smax(e, Math.max(I.h * (1 - d * d), -1.75), 0.25);
    }
    e += (U.fbm(x * 0.085 + 50, z * 0.085 + 50, 3) - 0.5) * 0.32;
    return e;
  }

  /* ---- baked fields ---- */
  let TW = 0, TH = 0, ELEV = null, REED = null, RED = null;
  function sample(grid, x, z) {
    const m = W.map;
    let fx = (x - m.x0) * m.res - 0.5, fz = (z - m.z0) * m.res - 0.5;
    fx = U.clamp(fx, 0, TW - 1.001); fz = U.clamp(fz, 0, TH - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, o = j * TW + i;
    return (grid[o] * (1 - u) + grid[o + 1] * u) * (1 - v) + (grid[o + TW] * (1 - u) + grid[o + TW + 1] * u) * v;
  }
  /** Ground height relative to the water surface (negative = depth). */
  W.elev = (x, z) => sample(ELEV, x, z);
  W.reedAt = (x, z) => sample(REED, x, z);
  W.redAt = (x, z) => sample(RED, x, z);

  W.posts = [];
  W.circles = []; // x, z, r
  W.caps = []; // ax, az, bx, bz, r
  W.decks = [{ x0: -0.78, x1: 0.78, z0: 3.2, z1: 10.3, y: 0.3 }];
  W.clearings = [];

  function placePosts() {
    W.legs.forEach((leg, li) => {
      let carry = 5.2, side = li % 2 ? 1 : -1, idx = 0;
      let total = 0;
      for (let i = 0; i + 1 < leg.length; i++) total += Math.hypot(leg[i + 1][0] - leg[i][0], leg[i + 1][1] - leg[i][1]);
      let run = 0;
      for (let i = 0; i + 1 < leg.length; i++) {
        const ax = leg[i][0], az = leg[i][1], bx = leg[i + 1][0], bz = leg[i + 1][1];
        const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
        while (carry <= len) {
          if (run + carry < total - 4.5) {
            const px = ax + tx * carry - tz * 1.35 * side, pz = az + tz * carry + tx * 1.35 * side;
            W.posts.push({ x: px, z: pz, leg: li, idx: idx++ });
            side = -side;
          }
          carry += 6.1;
        }
        carry -= len; run += len;
      }
    });
  }

  function bake() {
    const m = W.map;
    TW = m.w * m.res; TH = m.h * m.res;
    ELEV = new Float32Array(TW * TH); REED = new Float32Array(TW * TH); RED = new Float32Array(TW * TH);
    for (let j = 0; j < TH; j++) {
      const z = m.z0 + (j + 0.5) / m.res;
      for (let i = 0; i < TW; i++) ELEV[j * TW + i] = rawElev(m.x0 + (i + 0.5) / m.res, z);
    }
    const clear = W.clearings;
    for (const t of W.masts) clear.push([t.x, t.z + 0.6, 3.5]);
    clear.push([W.tower.x, W.tower.z + 0.6, 6.8], [0, 3.0, 1.9], [-40.5, -32.5, 5.5]);
    for (const p of W.posts) clear.push([p.x, p.z, 1.0]);
    for (let j = 0; j < TH; j++) {
      const z = m.z0 + (j + 0.5) / m.res;
      for (let i = 0; i < TW; i++) {
        const x = m.x0 + (i + 0.5) / m.res, e = ELEV[j * TW + i];
        if (e < -0.6 || e > 0.6) continue;
        // reeds hug the waterline, in patches
        let d = U.smoothstep(-0.27, -0.04, e) * (1 - U.smoothstep(0.15, 0.36, e));
        d *= U.smoothstep(0.45, 0.6, U.fbm(x * 0.105 + 31.7, z * 0.105 - 7.3, 3));
        d *= 0.3 + 0.7 * U.smoothstep(0.9, 2.8, pathDist(x, z));
        for (const b of REED_BANKS) {
          const q = Math.hypot((x - b[0]) / b[2], (z - b[1]) / b[3]);
          if (q < 1 && e > -0.5) d = Math.max(d, Math.min(1, (1 - q * q) * 1.6));
        }
        let r = 0;
        for (const b of RED_BEDS) {
          const q = Math.hypot((x - b[0]) / b[2], (z - b[1]) / b[3]);
          if (q < 1) r = Math.max(r, 1 - q * q);
        }
        r *= U.smoothstep(0.36, 0.56, U.fbm(x * 0.16 - 9, z * 0.16 + 4, 3)) * U.smoothstep(-0.16, -0.02, e);
        r = Math.min(1, r * 1.5);
        d *= 1 - r * 0.85;
        for (const c of clear) {
          const q = Math.hypot(x - c[0], z - c[1]);
          if (q < c[2]) { const k = U.smoothstep(c[2] * 0.55, c[2], q); d *= k; r *= 0.35 + 0.65 * k; }
        }
        REED[j * TW + i] = U.sat(d);
        RED[j * TW + i] = U.sat(r);
      }
    }
    const px = new Uint8Array(TW * TH * 4);
    for (let i = 0; i < TW * TH; i++) {
      px[i * 4] = U.clamp(Math.round((ELEV[i] / 4 + 0.5) * 255), 0, 255);
      px[i * 4 + 1] = Math.round(REED[i] * 255);
      px[i * 4 + 2] = Math.round(RED[i] * 255);
      px[i * 4 + 3] = 255;
    }
    W.mapPixels = px; W.mapW = TW; W.mapH = TH;
  }

  /* ---- vegetation: one instance per blade, grouped in chunks for culling ---- */
  W.CHUNK = 16;
  function growBlades() {
    const rnd = U.rng(20261115), m = W.map, CH = W.CHUNK;
    const nx = Math.ceil(m.w / CH), nz = Math.ceil(m.h / CH);
    const buckets = Array.from({ length: nx * nz }, () => []);
    const put = (x, z, h, tint, kind) => {
      const ci = Math.min(nx - 1, Math.floor((x - m.x0) / CH)), cj = Math.min(nz - 1, Math.floor((z - m.z0) / CH));
      buckets[cj * nx + ci].push(x, z, h, rnd(), tint[0], tint[1], tint[2], kind);
    };
    const SP = 0.165;
    for (let z = m.z0 + 1; z < m.z0 + m.h - 1; z += SP) {
      for (let x = m.x0 + 1; x < m.x0 + m.w - 1; x += SP) {
        const d = sample(REED, x, z);
        if (d > 0.02 && rnd() < d * 0.86) {
          const jx = x + (rnd() - 0.5) * SP, jz = z + (rnd() - 0.5) * SP;
          const t = rnd();
          const tint = [U.lerp(0.42, 0.74, t), U.lerp(0.52, 0.66, t), U.lerp(0.36, 0.38, t)];
          const g = 0.82 + rnd() * 0.3;
          put(jx, jz, (0.95 + 1.25 * rnd() * rnd() + 0.5 * d) * (0.75 + 0.25 * d), [tint[0] * g, tint[1] * g, tint[2] * g], rnd() < 0.32 ? 2 : 0);
        }
      }
    }
    const SR = 0.24;
    for (let z = m.z0 + 1; z < m.z0 + m.h - 1; z += SR) {
      for (let x = m.x0 + 1; x < m.x0 + m.w - 1; x += SR) {
        const r = sample(RED, x, z);
        if (r > 0.05 && rnd() < r * 0.6) {
          const t = rnd();
          put(x + (rnd() - 0.5) * SR, z + (rnd() - 0.5) * SR, 0.2 + rnd() * 0.3, [U.lerp(0.62, 0.9, t), U.lerp(0.13, 0.26, t), U.lerp(0.14, 0.2, t)], 1);
        }
      }
    }
    let total = 0;
    for (const b of buckets) total += b.length / 8;
    const data = new Float32Array(total * 8);
    const chunks = [];
    let o = 0;
    buckets.forEach((b, k) => {
      if (!b.length) return;
      data.set(b, o * 8);
      chunks.push({ x0: m.x0 + (k % nx) * CH, z0: m.z0 + Math.floor(k / nx) * CH, start: o, count: b.length / 8 });
      o += b.length / 8;
    });
    W.blades = { data, chunks, total };
  }

  /* ---- things standing on the flats ---- */
  const COL = {
    steel: [0.45, 0.5, 0.58], steelLt: [0.58, 0.63, 0.7], rust: [0.56, 0.31, 0.2], rustDk: [0.4, 0.22, 0.16],
    concrete: [0.56, 0.56, 0.54], wood: [0.5, 0.41, 0.3], bone: [0.68, 0.66, 0.62], brick: [0.56, 0.38, 0.31],
    rock: [0.44, 0.45, 0.48], dark: [0.12, 0.12, 0.14],
  };
  W.COL = COL;

  function lattice(b, x, z, y0, y1, wb, wt, rings, th, col) {
    const corner = (k, t) => {
      const sx = k === 0 || k === 3 ? -1 : 1, sz = k < 2 ? -1 : 1, w = U.lerp(wb, wt, t);
      return [x + sx * w, U.lerp(y0, y1, t), z + sz * w];
    };
    for (let k = 0; k < 4; k++) { const a = corner(k, 0), c = corner(k, 1); b.strut(a[0], a[1], a[2], c[0], c[1], c[2], th, col, MAT.METAL); }
    let prev = 0;
    for (const t of rings) {
      for (let k = 0; k < 4; k++) {
        const a = corner(k, t), c = corner((k + 1) % 4, t);
        b.strut(a[0], a[1], a[2], c[0], c[1], c[2], th * 0.8, col, MAT.METAL);
        if (k === 0) continue; // leave the far face open so the bracing stays readable
        const d = corner(k, prev), f = corner((k + 1) % 4, t);
        b.strut(d[0], d[1], d[2], f[0], f[1], f[2], th * 0.62, col, MAT.METAL);
        if (k === 2) { const g = corner(3, prev), h = corner(2, t); b.strut(g[0], g[1], g[2], h[0], h[1], h[2], th * 0.62, col, MAT.METAL); }
      }
      prev = t;
    }
  }

  function buildMast(b, x, z) {
    const H = W.MAST_H;
    b.box(x, 0.16, z, 2.0, 0.32, 2.0, 0, COL.concrete, MAT.STONE);
    lattice(b, x, z, 0.32, H, 0.72, 0.24, [0.3, 0.55, 0.78, 1], 0.13, COL.steel);
    b.box(x, H + 0.07, z, 0.72, 0.14, 0.72, 0, COL.steelLt, MAT.METAL);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.strut(x + sx * 0.3, H + 0.14, z + sz * 0.3, x + sx * 0.3, H + 0.86, z + sz * 0.3, 0.07, COL.steelLt, MAT.METAL);
    b.box(x, H + 0.9, z, 0.78, 0.1, 0.78, 0, COL.steelLt, MAT.METAL);
    b.strut(x, H + 0.95, z, x, H + 2.0, z, 0.07, COL.steelLt, MAT.METAL);
    b.strut(x - 0.5, H + 1.45, z, x + 0.5, H + 1.45, z, 0.06, COL.steelLt, MAT.METAL);
    // guy wires
    b.strut(x - 0.3, H * 0.74, z, x - 3.3, 0.02, z + 0.7, 0.06, COL.steel, MAT.METAL);
    b.strut(x + 0.3, H * 0.74, z, x + 3.3, 0.02, z + 0.7, 0.06, COL.steel, MAT.METAL);
    // junction box, where the lamp is handed over
    b.box(x, 0.72, z + 1.12, 0.56, 0.8, 0.34, 0, COL.rust, MAT.HULL);
    b.strut(x, 0.3, z + 1.0, x, 0.3, z + 0.7, 0.08, COL.rustDk, MAT.METAL, 0);
    W.circles.push([x, z, 1.25]);
  }

  function buildTower(b, x, z) {
    const H = W.TOWER_H;
    b.box(x, 0.3, z, 5.2, 0.6, 5.2, 0, COL.concrete, MAT.STONE);
    lattice(b, x, z, 0.6, H, 2.0, 0.62, [0.2, 0.38, 0.55, 0.72, 0.87, 1], 0.2, COL.steel);
    b.box(x, 8.4, z, 2.7, 0.14, 2.7, 0, COL.steelLt, MAT.METAL);
    for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) b.strut(x + sx * 1.3, 8.45, z + sz * 1.3, x + sx * 1.3, 9.2, z + sz * 1.3, 0.08, COL.steelLt, MAT.METAL);
    b.strut(x - 1.3, 9.2, z + 1.3, x + 1.3, 9.2, z + 1.3, 0.08, COL.steelLt, MAT.METAL);
    // lamp room
    b.box(x, H + 0.1, z, 1.5, 0.2, 1.5, 0, COL.steelLt, MAT.METAL);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.strut(x + sx * 0.62, H + 0.2, z + sz * 0.62, x + sx * 0.62, H + 1.5, z + sz * 0.62, 0.1, COL.steelLt, MAT.METAL);
    b.box(x, H + 1.56, z, 1.6, 0.14, 1.6, 0, COL.steelLt, MAT.METAL);
    b.strut(x, H + 1.6, z, x, H + 4.2, z, 0.1, COL.steelLt, MAT.METAL);
    b.strut(x - 0.9, H + 2.6, z, x + 0.9, H + 2.6, z, 0.07, COL.steelLt, MAT.METAL);
    b.strut(x - 0.55, H + 3.4, z, x + 0.55, H + 3.4, z, 0.07, COL.steelLt, MAT.METAL);
    // a dish, long silent
    const dx = x + 1.5, dy = 6.4, dz = z + 1.1;
    b.strut(dx - 0.9, dy - 0.8, dz, dx + 0.9, dy - 0.5, dz, 0.08, COL.steelLt, MAT.METAL);
    b.strut(dx + 0.9, dy - 0.5, dz, dx + 0.7, dy + 1.0, dz, 0.08, COL.steelLt, MAT.METAL);
    b.strut(dx + 0.7, dy + 1.0, dz, dx - 1.0, dy + 0.8, dz, 0.08, COL.steelLt, MAT.METAL);
    b.strut(dx - 1.0, dy + 0.8, dz, dx - 0.9, dy - 0.8, dz, 0.08, COL.steelLt, MAT.METAL);
    b.strut(dx - 0.95, dy - 0.75, dz, dx + 0.75, dy + 0.95, dz, 0.05, COL.steel, MAT.METAL);
    b.strut(dx + 0.85, dy - 0.5, dz, dx - 0.95, dy + 0.8, dz, 0.05, COL.steel, MAT.METAL);
    // keeper's cabin
    b.box(x - 4.2, 0.95, z + 0.9, 2.3, 1.9, 2.0, 0.06, COL.brick, MAT.STONE);
    b.box(x - 4.2, 2.0, z + 0.9, 2.6, 0.16, 2.3, 0.06, COL.rustDk, MAT.HULL);
    b.box(x - 4.75, 0.75, z + 1.92, 0.6, 1.3, 0.08, 0.06, COL.dark, MAT.WOOD);
    // console
    b.box(x, 0.86, z + 3.02, 0.9, 0.9, 0.4, 0, COL.rust, MAT.HULL);
    b.box(x, 1.36, z + 3.02, 1.0, 0.1, 0.5, 0, COL.steelLt, MAT.METAL);
    // guys
    b.strut(x - 0.9, 7.6, z, x - 6.4, 0.02, z + 2.2, 0.07, COL.steel, MAT.METAL);
    b.strut(x + 0.9, 7.6, z, x + 6.4, 0.02, z + 2.2, 0.07, COL.steel, MAT.METAL);
    W.caps.push([x - 2.1, z - 2.1, x + 2.1, z - 2.1, 0.75], [x - 2.1, z + 2.1, x + 2.1, z + 2.1, 0.75], [x - 2.1, z - 2.1, x - 2.1, z + 2.1, 0.75], [x + 2.1, z - 2.1, x + 2.1, z + 2.1, 0.75]);
    W.caps.push([x - 4.9, z + 0.9, x - 3.5, z + 0.9, 1.25]);
    W.circles.push([x, z + 3.02, 0.55]);
  }

  function buildJetty(b) {
    for (let z = 3.5; z < 10.2; z += 0.56) b.box(0, 0.3, z, 1.5, 0.08, 0.48, (U.hash2(z * 10, 3) - 0.5) * 0.06, COL.wood, MAT.WOOD);
    for (let z = 4.2; z < 10.4; z += 1.9) {
      for (const sx of [-0.82, 0.82]) {
        b.strut(sx, -0.6, z, sx, 0.62 + U.hash2(z * 7, sx * 9) * 0.25, z, 0.14, COL.wood, MAT.WOOD);
        W.circles.push([sx, z, 0.16]);
      }
    }
    b.strut(-0.82, 0.24, 3.4, -0.82, 0.24, 10.2, 0.08, COL.wood, MAT.WOOD);
    b.strut(0.82, 0.24, 3.4, 0.82, 0.24, 10.2, 0.08, COL.wood, MAT.WOOD);
    // the boat that brought you
    const bx = 2.05, bz = 8.6, yaw = 0.22;
    b.boxR(bx, 0.1, bz, 1.05, 0.5, 2.5, yaw, 0, 0.05, COL.bone, MAT.HULL);
    b.boxR(bx - Math.sin(yaw) * 1.45, 0.12, bz - Math.cos(yaw) * 1.45, 0.72, 0.46, 0.72, yaw + 0.785, 0, 0, COL.bone, MAT.HULL);
    b.boxR(bx, 0.33, bz, 0.78, 0.1, 2.0, yaw, 0, 0.05, COL.dark, MAT.WOOD);
    b.strut(bx - 0.6, 0.42, bz - 0.2, bx + 1.5, 0.3, bz + 0.5, 0.06, COL.wood, MAT.WOOD);
    b.strut(1.2, 0.34, 9.6, 0.82, 0.6, 9.9, 0.04, COL.bone, MAT.WOOD);
    W.caps.push([bx - Math.sin(yaw) * 1.3, bz - Math.cos(yaw) * 1.3, bx + Math.sin(yaw) * 1.0, bz + Math.cos(yaw) * 1.0, 0.62]);
  }

  function buildWreck(b) {
    const x = -40.6, z = -32.6, yaw = 0.52, roll = 0.24, pitch = -0.07;
    const fx = Math.sin(yaw), fz = Math.cos(yaw); // hull long axis in xz
    b.boxR(x, 0.42, z, 2.9, 2.3, 9.2, yaw, pitch, roll, COL.rust, MAT.HULL);
    b.boxR(x + fx * 5.2, 0.5, z + fz * 5.2, 2.0, 2.2, 2.0, yaw + 0.785, pitch, roll * 0.7, COL.rust, MAT.HULL);
    b.boxR(x - fx * 1.6 - 0.35, 1.95, z - fz * 1.6, 2.0, 1.5, 2.6, yaw, pitch, roll, COL.rustDk, MAT.HULL);
    b.boxR(x - fx * 1.6 - 0.55, 2.8, z - fz * 1.6, 2.3, 0.14, 2.9, yaw, pitch, roll, COL.steel, MAT.METAL);
    // rails and a snapped derrick
    for (let k = -3; k <= 3; k++) {
      const rx = x + fx * k * 1.2 + 1.05 * fz - 0.35, rz = z + fz * k * 1.2 - 1.05 * fx;
      b.strut(rx, 1.2, rz, rx - 0.2, 2.0, rz, 0.07, COL.steel, MAT.METAL);
    }
    b.strut(x + fx * 3.6 + 1.05 * fz - 0.5, 1.95, z + fz * 3.6 - 1.05 * fx, x - fx * 3.6 + 1.05 * fz - 0.5, 1.95, z - fz * 3.6 - 1.05 * fx, 0.07, COL.steel, MAT.METAL);
    b.strut(x + fx * 2.2, 1.4, z + fz * 2.2, x + fx * 3.1 - 1.9, 4.9, z + fz * 3.1 - 0.4, 0.16, COL.rustDk, MAT.METAL);
    b.strut(x + fx * 3.1 - 1.9, 4.9, z + fz * 3.1 - 0.4, x + fx * 3.4 - 2.9, 3.6, z + fz * 3.4 + 0.5, 0.08, COL.rustDk, MAT.METAL);
    W.caps.push([x - fx * 4.3, z - fz * 4.3, x + fx * 5.4, z + fz * 5.4, 1.7]);
  }

  function buildSaltWorks(b) {
    const walls = [
      // x1, z1, x2, z2, height
      [-39, -106.5, -33.5, -106.2, 1.25], [-32.2, -106.1, -30.4, -106.0, 0.6], [-39, -106.5, -39.4, -101.2, 1.05],
      [-39.4, -101.2, -34.6, -100.8, 0.85], [-33, -100.7, -30.2, -100.6, 0.5], [-30.2, -100.6, -30.4, -103.2, 0.95],
      [-22.4, -116.4, -17.2, -115.8, 1.15], [-17.2, -115.8, -16.8, -112.2, 0.7], [-22.4, -116.4, -22.8, -113.4, 0.9],
      [-34.6, -117.2, -30.2, -117.6, 0.75], [-35.2, -113.6, -34.6, -117.2, 1.1],
    ];
    for (const w of walls) {
      const len = Math.hypot(w[2] - w[0], w[3] - w[1]), yaw = Math.atan2(w[3] - w[1], w[2] - w[0]);
      const n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, hx = U.lerp(w[0], w[2], t), hz = U.lerp(w[1], w[3], t);
        const h = w[4] * (0.62 + 0.5 * U.hash2(Math.round(hx * 10), Math.round(hz * 10), 5));
        b.box(hx, h / 2, hz, len / n + 0.02, h, 0.52, yaw, COL.brick, MAT.STONE);
      }
      W.caps.push([w[0], w[1], w[2], w[3], 0.42]);
    }
    // a boiling pan, long cold
    b.box(-24.6, 0.7, -106.4, 1.7, 1.4, 1.7, 0.3, COL.rust, MAT.HULL);
    b.box(-24.6, 1.45, -106.4, 1.9, 0.12, 1.9, 0.3, COL.rustDk, MAT.METAL);
    b.strut(-24.2, 1.5, -106.2, -23.9, 3.3, -106.1, 0.16, COL.rustDk, MAT.METAL);
    W.circles.push([-24.6, -106.4, 1.15]);
    // old posts running out into the water
    for (let k = 0; k < 9; k++) {
      const px = -41.5 - k * 1.25, pz = -108.2 - k * 0.5;
      b.strut(px, -0.6, pz, px + 0.05, 0.7 + 0.5 * U.hash2(k, 4, 1), pz, 0.15, COL.wood, MAT.WOOD);
      W.circles.push([px, pz, 0.16]);
    }
  }

  function buildTree(b, x, z, s, seed) {
    const rnd = U.rng(seed), c = COL.bone;
    const top = [x + (rnd() - 0.5) * 0.6 * s, 2.3 * s, z + (rnd() - 0.5) * 0.3 * s];
    b.strut(x, -0.1, z, top[0], top[1], top[2], 0.2 * s, c, MAT.WOOD);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rnd() * 1.2, len = (1.0 + rnd() * 1.1) * s, t = 0.45 + rnd() * 0.5;
      const sx = U.lerp(x, top[0], t), sy = U.lerp(-0.1, top[1], t), sz = U.lerp(z, top[2], t);
      const ex = sx + Math.cos(a) * len, ey = sy + (0.5 + rnd() * 0.9) * len, ez = sz + Math.sin(a) * len * 0.5;
      b.strut(sx, sy, sz, ex, ey, ez, 0.11 * s, c, MAT.WOOD);
      for (let q = 0; q < 2; q++) {
        const a2 = a + (rnd() - 0.5) * 1.6, l2 = (0.45 + rnd() * 0.6) * s, t2 = 0.5 + rnd() * 0.5;
        const mx = U.lerp(sx, ex, t2), my = U.lerp(sy, ey, t2), mz = U.lerp(sz, ez, t2);
        b.strut(mx, my, mz, mx + Math.cos(a2) * l2, my + (0.3 + rnd() * 0.8) * l2, mz + Math.sin(a2) * l2 * 0.5, 0.07 * s, c, MAT.WOOD);
      }
    }
    W.circles.push([x, z, 0.3 * s]);
  }

  function buildRocks(b) {
    const rnd = U.rng(77123);
    let made = 0, tries = 0;
    while (made < 46 && tries++ < 4000) {
      const x = -60 + rnd() * 115, z = -172 + rnd() * 195;
      const e = W.elev(x, z);
      if (e < 0.06 || pathDist(x, z) < 2.2 || W.reedAt(x, z) > 0.4) continue;
      let ok = true;
      for (const c of W.clearings) if (Math.hypot(x - c[0], z - c[1]) < c[2] + 0.8) { ok = false; break; }
      if (!ok) continue;
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const s = 0.3 + rnd() * 0.55, ox = (rnd() - 0.5) * 0.9, oz = (rnd() - 0.5) * 0.6;
        const g = 0.8 + rnd() * 0.4;
        b.boxR(x + ox, s * 0.3, z + oz, s * (0.9 + rnd() * 0.6), s * 0.75, s * (0.8 + rnd() * 0.4), rnd() * 3, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, [COL.rock[0] * g, COL.rock[1] * g, COL.rock[2] * g], MAT.ROCK);
      }
      W.circles.push([x, z, 0.5]);
      made++;
    }
  }

  function buildPosts(b) {
    for (const p of W.posts) {
      const lean = (U.hash2(Math.round(p.x * 9), Math.round(p.z * 9), 2) - 0.5) * 0.3;
      p.top = [p.x + lean, 2.15, p.z];
      b.strut(p.x, -0.5, p.z, p.top[0], p.top[1], p.top[2], 0.11, COL.wood, MAT.WOOD);
      b.strut(p.top[0] - 0.24, 2.0, p.z, p.top[0] + 0.24, 2.0, p.z, 0.07, COL.wood, MAT.WOOD);
      W.circles.push([p.x, p.z, 0.2]);
    }
  }

  /* Fragments of old transmissions, drifting loose over the flats. */
  W.dust = [
    { x: -14.4, z: -18.6 }, { x: -43.2, z: -41.6 }, { x: -19.4, z: -48.6 }, { x: 28.2, z: -76.4 },
    { x: 2.4, z: -91.4 }, { x: -36.4, z: -103.6 }, { x: 17.2, z: -157.6 },
  ];
  W.herons = [{ x: -5.6, z: -18.4 }, { x: 8.6, z: -58.6 }, { x: -7.4, z: -99.6 }, { x: -6.5, z: -131.5 }];
  W.flock = { x: 11.5, z: -66.2, r: 3.4, n: 26 };
  W.trees = [[-13.4, -21.2, 1.15], [25.5, -67.5, 1.3], [-20.5, -104.2, 1.0], [31, -24, 1.4], [-47, -72, 1.3], [40, -112, 1.2], [-11.4, -128.2, 0.9], [27, 12, 1.2]];

  W.build = function () {
    placePosts();
    bake();
    growBlades();
    const b = (W.statics = new DS.BoxBatch(1400));
    W.masts.forEach((m) => buildMast(b, m.x, m.z));
    buildTower(b, W.tower.x, W.tower.z);
    buildJetty(b);
    buildWreck(b);
    buildSaltWorks(b);
    W.trees.forEach((t, i) => buildTree(b, t[0], t[1], t[2], 900 + i * 31));
    buildPosts(b);
    buildRocks(b);
  };

  W.onDeck = function (x, z) {
    for (const d of W.decks) if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) return d;
    return null;
  };
  W.walkable = (x, z) => !!W.onDeck(x, z) || W.elev(x, z) > -0.78;

  /** Push a circle of radius r out of every solid. Returns the corrected position. */
  W.collide = function (x, z, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of W.circles) {
        const dx = x - c[0], dz = z - c[1], rr = r + c[2];
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), k = (rr - d) / d; x += dx * k; z += dz * k; }
      }
      for (const c of W.caps) {
        const ax = c[0], az = c[1], bx = c[2] - ax, bz = c[3] - az;
        const l2 = bx * bx + bz * bz;
        let t = l2 > 0 ? ((x - ax) * bx + (z - az) * bz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (ax + bx * t), dz = z - (az + bz * t), rr = r + c[4];
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), k = (rr - d) / d; x += dx * k; z += dz * k; }
      }
    }
    return [x, z];
  };
})();
