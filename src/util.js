/* Dust & Signal — shared helpers, material ids and the instanced-box builder. */
(function () {
  'use strict';
  const DS = (window.DS = window.DS || {});
  const U = (DS.util = {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (a, b, x) => {
    const t = U.sat((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  /** Frame-rate independent exponential approach. */
  U.damp = (cur, target, lambda, dt) => target + (cur - target) * Math.exp(-lambda * dt);
  U.angleDelta = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  U.hash2 = (x, y, s = 0) => {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  /** mulberry32 */
  U.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = U.hash2(xi, yi, 7), b = U.hash2(xi + 1, yi, 7);
    const c = U.hash2(xi, yi + 1, 7), d = U.hash2(xi + 1, yi + 1, 7);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  U.fbm = (x, y, oct = 4) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * U.vnoise(x * f, y * f);
      n += a; a *= 0.5; f *= 2.03;
    }
    return s / n;
  };
  /** Distance from point to segment in the xz plane. */
  U.distSeg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return Math.sqrt(cx * cx + cz * cz);
  };

  /* Material ids. The glyph pass turns each one into its own family of characters. */
  DS.MAT = {
    VOID: 0, WATER: 1, SALT: 2, REED: 3, RED: 4, METAL: 5, HULL: 6, GLOW: 7, FIGURE: 8,
    WOOD: 9, SHALLOW: 10, STONE: 11, BIRD: 12, STAR: 13, MOON: 14, AURORA: 15, CLOUD: 16, ROCK: 17,
  };
  DS.MAT_COUNT = 18;

  /**
   * A growable list of oriented boxes for instanced drawing.
   * Layout per box (24 floats): mat4 model, rgb + emissive, material, strut flag, glint, spare.
   */
  const STRIDE = 24;
  class BoxBatch {
    constructor(cap = 256) {
      this.f = new Float32Array(cap * STRIDE);
      this.n = 0;
    }
    reset() { this.n = 0; }
    _grow() {
      const g = new Float32Array(this.f.length * 2);
      g.set(this.f);
      this.f = g;
    }
    /** Box given centre, three unit axes and sizes along them. */
    obox(cx, cy, cz, ax, ay, az, bx, by, bz, dx, dy, dz, sx, sy, sz, col, mat, strut = 0, emis = 0, glint = 0) {
      if ((this.n + 1) * STRIDE > this.f.length) this._grow();
      const f = this.f, o = this.n * STRIDE;
      f[o] = ax * sx; f[o + 1] = ay * sx; f[o + 2] = az * sx; f[o + 3] = 0;
      f[o + 4] = bx * sy; f[o + 5] = by * sy; f[o + 6] = bz * sy; f[o + 7] = 0;
      f[o + 8] = dx * sz; f[o + 9] = dy * sz; f[o + 10] = dz * sz; f[o + 11] = 0;
      f[o + 12] = cx; f[o + 13] = cy; f[o + 14] = cz; f[o + 15] = 1;
      f[o + 16] = col[0]; f[o + 17] = col[1]; f[o + 18] = col[2]; f[o + 19] = emis;
      f[o + 20] = mat; f[o + 21] = strut; f[o + 22] = glint; f[o + 23] = 0;
      this.n++;
    }
    /** Axis-aligned box turned by `yaw` about the vertical. */
    box(cx, cy, cz, sx, sy, sz, yaw, col, mat, emis = 0) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this.obox(cx, cy, cz, c, 0, s, 0, 1, 0, -s, 0, c, sx, sy, sz, col, mat, 0, emis);
    }
    /** Box with yaw, then pitch (about local x), then roll (about local z). */
    boxR(cx, cy, cz, sx, sy, sz, yaw, pitch, roll, col, mat, emis = 0) {
      const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      // R = Ry(yaw) * Rx(pitch) * Rz(roll), columns are the box axes
      const m00 = cy_ * cr + sy_ * sp * sr, m01 = -cy_ * sr + sy_ * sp * cr, m02 = sy_ * cp;
      const m10 = cp * sr, m11 = cp * cr, m12 = -sp;
      const m20 = -sy_ * cr + cy_ * sp * sr, m21 = sy_ * sr + cy_ * sp * cr, m22 = cy_ * cp;
      this.obox(cx, cy, cz, m00, m10, m20, m01, m11, m21, m02, m12, m22, sx, sy, sz, col, mat, 0, emis);
    }
    /** A thin bar from a to b. Directional bars tell the glyph pass which way they run. */
    strut(x1, y1, z1, x2, y2, z2, th, col, mat, directional = 1, emis = 0) {
      let vx = x2 - x1, vy = y2 - y1, vz = z2 - z1;
      const len = Math.hypot(vx, vy, vz);
      if (len < 1e-5) return;
      vx /= len; vy /= len; vz /= len;
      // any axis not parallel to the bar
      let rx = 0, ry = 1, rz = 0;
      if (Math.abs(vy) > 0.98) { rx = 1; ry = 0; }
      // X = normalize(ref x V), Z = X x V
      let ax = ry * vz - rz * vy, ay = rz * vx - rx * vz, az = rx * vy - ry * vx;
      const al = Math.hypot(ax, ay, az);
      ax /= al; ay /= al; az /= al;
      const zx = ay * vz - az * vy, zy = az * vx - ax * vz, zz = ax * vy - ay * vx;
      this.obox((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, ax, ay, az, vx, vy, vz, zx, zy, zz, th, len, th, col, mat, directional, emis);
    }
  }
  BoxBatch.STRIDE = STRIDE;
  DS.BoxBatch = BoxBatch;
})();
