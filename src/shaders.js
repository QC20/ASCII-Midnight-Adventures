/* Dust & Signal — GLSL.
 *
 * The scene is drawn into a small G-buffer (colour, glyph hints, extras) a few samples per
 * character cell. `resolve` then votes on one glyph and one ink colour per cell, and `comp`
 * prints the glyph grid to the screen. Geometry tells the glyph pass what it is (material)
 * and which way it runs (direction), so reeds become strokes and ripples become rings.
 */
(function () {
  'use strict';
  const DS = window.DS, M = DS.MAT;
  const SH = (DS.shaders = {});
  const id = (n) => n.toFixed(1);

  const HEAD = `#version 300 es
precision highp float;
precision highp int;
const float PI = 3.14159265;
const float TAU = 6.2831853;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n * 17.13 + 3.1)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.9375; }
// a line direction (mod 180 degrees) or a full direction, packed into one byte; 0 means "none"
float encLine(vec2 d) { if (dot(d, d) < 1e-10) return 0.0; float a = mod(atan(d.y, d.x), PI); return (1.0 + floor(a / PI * 253.0 + 0.5)) / 255.0; }
float encFull(vec2 d) { if (dot(d, d) < 1e-12) return 0.0; float a = mod(atan(d.y, d.x), TAU); return (1.0 + floor(a / TAU * 253.0 + 0.5)) / 255.0; }
`;

  // Orthographic camera tilted down by a fixed angle. uMirror = -1 draws the world upside
  // down through the water plane, which is all a planar reflection is.
  const CAM = `
uniform vec3 uCam;
uniform vec2 uView;
uniform vec2 uSC;
uniform float uMirror;
vec4 project(vec3 p) {
  float y = p.y * uMirror;
  float dz = p.z - uCam.z;
  return vec4((p.x - uCam.x) / uView.x, (y * uSC.y - dz * uSC.x) / uView.y, clamp((-y * uSC.x - dz * uSC.y) / 140.0, -1.0, 1.0), 1.0);
}
vec2 screenDir(vec3 v) { return vec2(v.x, v.y * uMirror * uSC.y - v.z * uSC.x); }
`;

  const LIGHT = `
#define NL 24
uniform vec4 uLP[NL];
uniform vec3 uLC[NL];
uniform int uLN;
uniform vec3 uAmb;
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform vec4 uPulse[2];
uniform vec3 uPulseCol[2];
vec3 lightAt(vec3 p, vec3 n, float wrap) {
  vec3 L = uAmb + uMoonCol * max(dot(n, uMoonDir), 0.0);
  for (int i = 0; i < NL; i++) {
    if (i >= uLN) break;
    vec3 d = uLP[i].xyz - p;
    float dist = length(d);
    float a = clamp(1.0 - dist / uLP[i].w, 0.0, 1.0);
    float ndl = clamp(dot(n, d) / max(dist, 0.001) * (1.0 - wrap) + wrap, 0.0, 1.0);
    L += uLC[i] * (a * a * ndl);
  }
  // a ring of light travelling outward when a mast wakes
  for (int i = 0; i < 2; i++) {
    float q = (length(p.xz - uPulse[i].xy) - uPulse[i].z) / 1.7;
    L += uPulseCol[i] * (uPulse[i].w * exp(-q * q));
  }
  return L;
}
`;

  const TERRAIN = `
uniform sampler2D uTerrain;
uniform vec4 uMapRect;
vec4 terrain(vec2 w) { return texture(uTerrain, (w - uMapRect.xy) * uMapRect.zw); }
float elevOf(vec4 t) { return (t.r - 0.5) * 4.0; }
`;

  // Voronoi with distance to the nearest cell border: the salt polygons.
  const VORONOI = `
vec4 voronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  vec2 en = vec2(1.0, 0.0);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + hash22(n + g) - f;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 0.00001) {
      vec2 nn = normalize(dr);
      float d = dot(0.5 * (mr + r), nn);
      if (d < md) { md = d; en = nn; }
    }
  }
  return vec4(md, hash21(n + mg + 0.5), en.y, -en.x);
}
`;

  const GOUT = `
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oHint;
layout(location=2) out vec4 oAux;
`;

  SH.fsVS = `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- ground + water */
  SH.groundFS = HEAD + CAM + LIGHT + TERRAIN + VORONOI + GOUT + `
in vec2 vNdc;
uniform sampler2D uReflColor;
uniform sampler2D uReflHint;
uniform sampler2D uSim;
uniform vec4 uSimRect;
uniform float uSimOn;
uniform float uTime;
uniform vec3 uWind;

void main() {
  vec2 s = vNdc * uView;
  vec2 w = vec2(uCam.x + s.x, uCam.z - s.y / uSC.x);
  vec3 p = vec3(w.x, 0.0, w.y);
  vec4 tm = terrain(w);
  float e = elevOf(tm) + (vnoise(w * 1.7) - 0.5) * 0.08;
  vec4 vor = voronoi(w * 0.52 + 3.7);
  float ridge = 1.0 - smoothstep(0.03, 0.1, vor.x);
  vec2 ridgeDir = screenDir(vec3(vor.z, 0.0, vor.w));
  vec3 L = lightAt(p, vec3(0.0, 1.0, 0.0), 0.0);

  if (e > 0.0) {
    float wet = 1.0 - smoothstep(0.0, 0.1, e);
    float veg = tm.g;
    vec3 salt = mix(vec3(0.6, 0.585, 0.55), vec3(0.74, 0.72, 0.66), vor.y);
    salt = mix(salt, vec3(0.98, 0.96, 0.9), ridge * 0.9);
    salt *= 0.8 + 0.2 * vnoise(w * 3.3);
    vec3 alb = mix(salt, vec3(0.2, 0.215, 0.17), clamp(veg * 0.8 + wet * 0.5, 0.0, 0.92));
    float red = tm.b;
    float rs = smoothstep(0.42, 0.62, vnoise(w * 3.7 + 9.0) * 0.55 + red * 0.62) * step(0.05, red);
    alb = mix(alb, vec3(0.7, 0.17, 0.16), rs * 0.9);
    vec3 col = alb * L;
    float h1 = hash21(floor(w * 4.0));
    float spark = step(0.994, h1) * (0.5 + 0.5 * sin(uTime * 2.3 + h1 * 300.0)) * (1.0 - veg) * (1.0 - rs);
    float gl = spark * smoothstep(0.3, 0.9, lum(L));
    float dir = (ridge > 0.45 && veg < 0.6 && rs < 0.5) ? encLine(ridgeDir) : 0.0;
    oColor = vec4(col + vec3(1.0, 0.95, 0.85) * gl * 0.5, 0.0);
    oHint = vec4((rs > 0.5 ? ${id(M.RED)} : ${id(M.SALT)}) / 255.0, dir, gl, 0.0);
    oAux = vec4(0.0);
    return;
  }

  float depth = -e;
  vec2 suv = (w - uSimRect.xy) * uSimRect.z;
  float tx = uSimRect.w * uSimRect.z;
  vec4 sm = texture(uSim, suv);
  float hL = texture(uSim, suv - vec2(tx, 0.0)).r, hR = texture(uSim, suv + vec2(tx, 0.0)).r;
  float hD = texture(uSim, suv - vec2(0.0, tx)).r, hU = texture(uSim, suv + vec2(0.0, tx)).r;
  float inWin = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0) * uSimOn;
  vec2 g = vec2(hR - hL, hU - hD) / (2.0 * uSimRect.w) * inWin;

  vec2 chop = vec2(vnoise(w * vec2(0.7, 2.3) + uTime * vec2(0.23, 0.06)), vnoise(w * vec2(0.8, 2.7) + 17.0 - uTime * vec2(0.19, 0.05))) - 0.5;
  vec2 dis = vec2(g.x, -g.y * uSC.x) * 1.5 + chop * (0.05 + 0.1 * uWind.z);
  vec2 ruv = vNdc * 0.5 + 0.5 + dis / (2.0 * uView);
  vec4 rc = texture(uReflColor, ruv);
  vec4 rh = texture(uReflHint, ruv);
  float rl = lum(rc.rgb);

  // the bottom shows through where it is shallow: that is how you read the fords
  float vis = exp(-depth * 3.0);
  vec3 bott = mix(vec3(0.3, 0.37, 0.44), vec3(0.42, 0.5, 0.56), vor.y);
  bott = mix(bott, vec3(0.62, 0.7, 0.76), ridge * 0.8);
  vec3 col = bott * L * vis * 0.6;

  float slope = length(g);
  float rs = smoothstep(0.015, 0.11, slope);
  col += (L * vec3(0.75, 0.86, 1.0) * 1.6 + vec3(0.03, 0.045, 0.08)) * rs;
  col += rc.rgb * 0.8;

  float st = vnoise(vec2(w.x * 0.31 + uTime * 0.06, w.y * 2.6 + 5.0));
  float streak = smoothstep(0.74, 0.88, st) * (0.3 + 0.7 * vnoise(w * 0.09 - uTime * 0.015));
  col += (vec3(0.035, 0.05, 0.085) + L * 0.08) * streak;
  float shore = 1.0 - smoothstep(0.0, 0.07, depth);
  col += (vec3(0.05, 0.07, 0.1) + L * 0.25) * shore * (0.6 + 0.4 * sin(w.x * 3.0 + uTime * 1.2));

  float mat = ${id(M.WATER)} / 255.0, dir = 0.0, b = 0.0, refl = 0.0;
  if (rs > 0.3) {
    vec2 pr = -sm.g * g; // which way this wavefront is heading
    dir = encFull(vec2(pr.x, -pr.y * uSC.x));
    b = rs;
  } else if (rh.r > 0.002 && rl + rc.a > 0.015) {
    mat = rh.r; dir = rh.g; b = rh.b * 0.7; refl = 1.0;
  } else if (vis > 0.3) {
    mat = ${id(M.SHALLOW)} / 255.0;
    dir = ridge > 0.5 ? encLine(ridgeDir) : 0.0;
  }
  float skyVis = clamp(1.0 - vis * 1.3, 0.0, 1.0) * (1.0 - shore) * (1.0 - clamp(rl * 8.0 + rc.a * 2.0, 0.0, 1.0));
  oColor = vec4(col, rc.a * 0.8);
  oHint = vec4(mat, dir, b, 0.0);
  oAux = vec4(skyVis, refl, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- boxes */
  SH.boxVS = HEAD + CAM + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec4 iM0;
layout(location=3) in vec4 iM1;
layout(location=4) in vec4 iM2;
layout(location=5) in vec4 iM3;
layout(location=6) in vec4 iCol;
layout(location=7) in vec4 iPar;
out vec3 vW;
out vec3 vN;
out vec4 vCol;
out vec4 vPar;
out vec2 vDir;
void main() {
  mat4 Mm = mat4(iM0, iM1, iM2, iM3);
  vec4 wp = Mm * vec4(aPos, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(Mm) * aNor);
  vCol = iCol;
  vPar = iPar;
  vDir = screenDir((Mm * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  gl_Position = project(wp.xyz);
}`;

  SH.boxFS = HEAD + CAM + LIGHT + GOUT + `
in vec3 vW;
in vec3 vN;
in vec4 vCol;
in vec4 vPar;
in vec2 vDir;
void main() {
  if (vW.y < 0.0) discard;
  vec3 L = lightAt(vW, normalize(vN), 0.35);
  vec3 col = vCol.rgb * L + vCol.rgb * vCol.a * 2.0;
  oColor = vec4(col, vCol.a);
  oHint = vec4(vPar.x / 255.0, vPar.y > 0.5 ? encLine(vDir) : 0.0, vPar.z, 0.0);
  oAux = vec4(0.0, 0.0, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- reeds */
  SH.bladeVS = HEAD + CAM + `
layout(location=0) in vec2 aV;
layout(location=1) in vec4 iRoot;
layout(location=2) in vec4 iTint;
uniform float uTime;
uniform vec3 uPlayer;
uniform vec3 uWind;
uniform float uBladeW;
out vec3 vW;
out vec3 vCol;
out float vT;
out vec2 vDir;
out float vKind;
void main() {
  float t = aV.x, h = iRoot.z;
  vec2 root = iRoot.xy;
  vec2 wd = uWind.xy;
  // gusts roll across the reed beds as travelling noise
  float gust = vnoise(root * 0.13 - wd * uTime * 0.55) * 0.75 + vnoise(root * 0.41 - wd * uTime * 1.3) * 0.25;
  vec2 off = wd * (0.08 + 0.62 * gust * gust) * uWind.z;
  off += 0.045 * vec2(sin(uTime * 1.7 + iRoot.w * 43.0), cos(uTime * 1.3 + iRoot.w * 29.0));
  // and they part around whoever wades through
  vec2 dp = root - uPlayer.xz;
  float dd = length(dp);
  float push = 1.0 - smoothstep(0.15, 1.5, dd);
  off += dp / max(dd, 0.05) * push * 0.8;
  float flat_ = 1.0 - 0.4 * push;
  float bend = min(length(off), 0.95);
  vec3 p = vec3(root.x + off.x * h * t * t, h * t * flat_ * sqrt(1.0 - bend * bend * t * t * 0.8), root.y + off.y * h * t * t);
  p.x += aV.y * uBladeW * (1.0 - 0.7 * t) * (0.8 + 0.4 * fract(iRoot.w * 7.0)) * 0.5;
  vW = p;
  vT = t;
  vCol = iTint.rgb;
  vKind = iTint.a;
  vDir = screenDir(vec3(2.0 * off.x * h * t, h * flat_, 2.0 * off.y * h * t));
  gl_Position = project(p);
}`;

  SH.bladeFS = HEAD + CAM + LIGHT + GOUT + `
in vec3 vW;
in vec3 vCol;
in float vT;
in vec2 vDir;
in float vKind;
void main() {
  if (vW.y < 0.0) discard;
  vec3 L = lightAt(vW, normalize(vec3(0.0, 0.55, 0.8)), 0.55);
  float tip = (vKind > 1.5 && vT > 0.86) ? 1.0 : 0.0;
  vec3 col = mix(vCol, vec3(0.86, 0.8, 0.62), tip * 0.7) * L * (0.42 + 0.58 * vT + tip * 0.35);
  float red = (vKind > 0.5 && vKind < 1.5) ? 1.0 : 0.0;
  oColor = vec4(col, 0.0);
  oHint = vec4(mix(${id(M.REED)}, ${id(M.RED)}, red) / 255.0, encLine(vDir), 0.0, 0.0);
  oAux = vec4(0.0, 0.0, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- particles */
  SH.partVS = HEAD + CAM + `
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 iPos;
layout(location=2) in vec4 iCol;
out vec2 vQ;
out vec4 vCol;
out float vY;
void main() {
  vQ = aQ; vCol = iCol; vY = iPos.y;
  vec4 c = project(iPos.xyz);
  c.xy += aQ * iPos.w / uView;
  gl_Position = c;
}`;

  SH.partFS = HEAD + GOUT + `
in vec2 vQ;
in vec4 vCol;
in float vY;
void main() {
  if (vY < 0.0 || dot(vQ, vQ) > 1.0) discard;
  oColor = vec4(vCol.rgb * (0.5 + vCol.a), vCol.a);
  oHint = vec4(${id(M.GLOW)} / 255.0, 0.0, vCol.a, 0.0);
  oAux = vec4(0.0, 0.0, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- ripple simulation */
  SH.simFS = HEAD + `
in vec2 vNdc;
uniform sampler2D uPrev;
uniform sampler2D uTerrain;
uniform vec4 uMapRect;
uniform vec4 uSimRect;
uniform vec2 uShift;
uniform float uC2;
uniform float uDamp;
uniform vec4 uSrc[16];
uniform int uNSrc;
out vec4 o;
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec2 puv = uv + uShift;
  float tx = uSimRect.w * uSimRect.z;
  vec4 c = texture(uPrev, puv);
  float h = c.r, v = c.g;
  float lap = texture(uPrev, puv + vec2(tx, 0.0)).r + texture(uPrev, puv - vec2(tx, 0.0)).r
            + texture(uPrev, puv + vec2(0.0, tx)).r + texture(uPrev, puv - vec2(0.0, tx)).r - 4.0 * h;
  v = (v + lap * uC2) * uDamp;
  h = (h + v) * 0.9992;
  vec2 w = uSimRect.xy + uv / uSimRect.z;
  for (int i = 0; i < 16; i++) {
    if (i >= uNSrc) break;
    vec2 d = w - uSrc[i].xy;
    h += uSrc[i].w * exp(-dot(d, d) / (uSrc[i].z * uSrc[i].z));
  }
  float e = (texture(uTerrain, (w - uMapRect.xy) * uMapRect.zw).r - 0.5) * 4.0;
  float m = 1.0 - smoothstep(-0.1, 0.02, e);
  float edge = min(min(puv.x, 1.0 - puv.x), min(puv.y, 1.0 - puv.y));
  m *= smoothstep(0.0, 0.03, edge);
  o = vec4(clamp(h, -4.0, 4.0) * m, clamp(v, -4.0, 4.0) * m, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- one glyph per cell */
  SH.resolveFS = HEAD + `
uniform sampler2D uColor;
uniform sampler2D uHint;
uniform sampler2D uAux;
uniform sampler2D uLUT;
uniform ivec2 uSS;
uniform ivec2 uOrigin;
uniform float uTime;
uniform float uExposure;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oGly;

const int NM = ${DS.MAT_COUNT};
// how readily a material claims a cell, and how much of its colour floods the cell behind the glyph
const float PRIO[NM] = float[NM](0.25, 0.55, 1.0, 1.7, 1.2, 2.6, 2.0, 5.0, 3.2, 2.2, 0.8, 1.7, 5.0, 1.0, 1.0, 1.0, 1.0, 1.8);
const float FILL[NM] = float[NM](0.0, 0.0, 0.06, 0.05, 0.08, 0.07, 0.16, 0.5, 0.22, 0.1, 0.04, 0.14, 0.1, 0.0, 0.0, 0.0, 0.0, 0.14);

float lut(int col, int mat) { return texelFetch(uLUT, ivec2(col, mat), 0).r * 255.0; }

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 base = cell * uSS;
  vec4 cs[15];
  vec4 hs[15];
  vec2 ax[15];
  float wm[NM];
  for (int k = 0; k < NM; k++) wm[k] = 0.0;
  int n = 0;
  float sky = 0.0, emis = 0.0, glMax = 0.0;
  vec3 glCol = vec3(0.0);
  for (int j = 0; j < uSS.y; j++) {
    for (int i = 0; i < uSS.x; i++) {
      ivec2 q = base + ivec2(i, j);
      vec4 c = texelFetch(uColor, q, 0);
      vec4 h = texelFetch(uHint, q, 0);
      vec4 a = texelFetch(uAux, q, 0);
      int m = int(h.r * 255.0 + 0.5);
      if (m >= NM) m = 0;
      wm[m] += (lum(c.rgb) + 0.012) * PRIO[m];
      sky += a.r;
      emis += c.a;
      if (m != ${M.WATER} && h.b > glMax) { glMax = h.b; glCol = c.rgb; }
      cs[n] = c; hs[n] = h; ax[n] = a.rg;
      n++;
    }
  }
  float fn = float(n);
  int Mx = 0;
  float best = -1.0;
  for (int k = 0; k < NM; k++) if (wm[k] > best) { best = wm[k]; Mx = k; }
  bool water = (Mx == ${M.WATER});

  vec3 ink = vec3(0.0);
  float ws = 0.0, lumM = 0.0, cnt = 0.0, refl = 0.0, dw = 0.0, str = 0.0;
  vec2 ds = vec2(0.0);
  for (int k = 0; k < n; k++) {
    int m = int(hs[k].r * 255.0 + 0.5);
    if (m != Mx) continue;
    float l = lum(cs[k].rgb);
    float wgt = l + 0.02;
    ink += cs[k].rgb * wgt; ws += wgt; lumM += l; cnt += 1.0; refl += ax[k].y;
    if (hs[k].g > 0.0) {
      // both encodings decode to an angle on the full circle (a line's is doubled)
      float ang = (hs[k].g * 255.0 - 1.0) / 253.0 * TAU;
      float ww = water ? hs[k].b : wgt;
      ds += vec2(cos(ang), sin(ang)) * ww; dw += ww;
    }
    if (water) str += hs[k].b;
  }
  ink /= max(ws, 1e-4);
  lumM /= max(cnt, 1.0);
  refl /= max(cnt, 1.0);
  str /= max(cnt, 1.0);
  float cover = cnt / fn;
  float Lv = clamp(lumM * mix(0.55, 1.0, cover) * uExposure, 0.0, 1.0);
  int lev = int(clamp(sqrt(Lv) * 16.0, 0.0, 15.0));

  ivec2 wc = cell + uOrigin;
  int var = int(hash21(vec2(wc) + 0.5) * 4.0);
  float coh = length(ds) / max(dw, 1e-4);
  float gi = 0.0;
  if (Mx == 0) {
    gi = 0.0;
  } else if (water) {
    if (str > 0.3 && coh > 0.25) {
      int b = int(mod(floor(atan(ds.y, ds.x) / 0.7853982 + 0.5), 8.0));
      gi = lut(64 + b * 4 + var, Mx);
    } else {
      gi = lut(lev * 4 + var, Mx);
    }
  } else if (dw / max(ws, 1e-4) > 0.3 && coh > 0.3) {
    int b = int(mod(floor(0.5 * atan(ds.y, ds.x) / 0.3926991 + 0.5) + 8.0, 8.0));
    gi = lut(64 + b * 4 + var, Mx);
  } else {
    gi = lut(lev * 4 + var, Mx);
  }

  float bright = mix(0.34, 1.0, pow(Lv, 0.45));
  float fill = FILL[Mx];
  if (refl > 0.5) {
    // reflections break up into dashes, more on alternate rows, and never sit still
    float sh = hash21(vec2(float(wc.x) * 0.37 + floor(uTime * 2.2 + float(wc.y) * 0.7), float(wc.y)));
    if (sh < (mod(float(wc.y), 2.0) < 0.5 ? 0.5 : 0.2)) gi = lut(8 * 4 + var, ${M.WATER});
    bright *= 0.8;
    fill *= 0.4;
  }
  if (glMax > 0.25 && !water) {
    gi = lut(int(clamp(glMax * 15.99, 0.0, 15.0)) * 4 + var, ${M.GLOW});
    ink = glCol; bright = 1.0; fill = max(fill, 0.25);
  }
  vec3 hue = ink / max(max(ink.r, max(ink.g, ink.b)), 1e-3);
  oCol = vec4(hue * bright, clamp(emis / fn + glMax * 0.5, 0.0, 1.0));
  oGly = vec4(gi / 255.0, sky / fn, fill, 1.0);
}`;

  /* ---------------------------------------------------------------- the sky, seen only in the water */
  SH.skyFS = HEAD + TERRAIN + `
uniform vec2 uRes;
uniform vec2 uCellPx;
uniform float uWuPerPx;
uniform vec3 uCamTrue;
uniform vec2 uSC;
uniform float uTime;
uniform float uAurora;
uniform float uCloud;
uniform float uStar;
uniform float uMoon;
uniform vec2 uMoonPos;
uniform float uMoonR;
uniform sampler2D uSim;
uniform sampler2D uLUT;
uniform vec4 uSimRect;
uniform float uSimOn;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oGly;

float lut(int col, int mat) { return texelFetch(uLUT, ivec2(col, mat), 0).r * 255.0; }

void main() {
  oCol = vec4(0.0);
  oGly = vec4(0.0);
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 Q = ((cell + 0.5) * uCellPx - uRes * 0.5) * uWuPerPx;
  vec2 w = vec2(uCamTrue.x + Q.x, uCamTrue.z - Q.y / uSC.x);
  if (elevOf(terrain(w)) > -0.02) return;

  vec2 suv = (w - uSimRect.xy) * uSimRect.z;
  float tx = uSimRect.w * uSimRect.z;
  float hL = texture(uSim, suv - vec2(tx, 0.0)).r, hR = texture(uSim, suv + vec2(tx, 0.0)).r;
  float hD = texture(uSim, suv - vec2(0.0, tx)).r, hU = texture(uSim, suv + vec2(0.0, tx)).r;
  float inWin = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0) * uSimOn;
  vec2 g = vec2(hR - hL, hU - hD) / (2.0 * uSimRect.w) * inWin;
  vec2 sc = Q + vec2(g.x, -g.y * uSC.x) * 4.0;

  vec2 cellWU = uCellPx * uWuPerPx;
  // the sky stays with the camera; only a whisper of parallax as you travel
  vec2 par = vec2(uCamTrue.x, -uCamTrue.z * uSC.x) * 0.04;
  float cl = fbm((sc + par * 3.0) * vec2(0.055, 0.09) + uTime * vec2(0.012, 0.004));
  float cover = smoothstep(0.62 - uCloud * 0.6, 0.86 - uCloud * 0.6, cl);

  vec3 col = vec3(0.0);
  float gi = 0.0, glow = 0.0, top = 0.0;

  // stars: one lattice site per character cell, so a star is exactly one glyph
  vec2 sid = floor((sc + par) / cellWU);
  float h = hash21(sid + 0.5);
  float mw = smoothstep(0.38, 0.72, fbm(sid * cellWU * vec2(0.05, 0.08) + vec2(sid.y * cellWU.y * 0.06, 0.0)));
  if (h > 0.9905 - mw * 0.02) {
    float br = fract(h * 733.1);
    float tw = 0.65 + 0.35 * sin(uTime * (1.0 + br * 3.0) + h * 400.0);
    float I = (0.35 + 0.65 * br * br) * tw * uStar * (1.0 - cover);
    if (I > 0.1) {
      col = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.9, 0.74), step(0.82, fract(h * 91.7))) * (0.55 + 0.45 * I);
      gi = lut(int(clamp(I * 16.0, 0.0, 15.0)) * 4, ${M.STAR});
      glow = I * I * 0.35; top = I;
    }
  }

  // clouds
  if (cover > 0.35) {
    float I = (cover - 0.35) * 0.5 * (0.5 + 0.5 * vnoise(sc * vec2(0.3, 1.9) + uTime * 0.03));
    if (I > top * 0.6 && I > 0.06) {
      col = vec3(0.3, 0.35, 0.47) * (0.6 + I);
      gi = lut(int(clamp(I * 22.0, 0.0, 15.0)) * 4 + int(hash21(cell) * 4.0), ${M.CLOUD});
      glow = 0.0; top = I;
    }
  }

  // moon
  vec2 md = (sc - uMoonPos) / uMoonR;
  float mr = length(md);
  if (mr < 1.0) {
    float I = (0.56 + 0.44 * fbm(md * 2.3 + 7.0)) * (1.0 - 0.3 * mr * mr) * uMoon * (1.0 - cover * 0.8);
    if (I > 0.08) {
      col = vec3(0.93, 0.95, 0.88) * (0.5 + 0.5 * I);
      gi = lut(int(clamp(I * 16.0, 0.0, 15.0)) * 4 + int(hash21(cell) * 4.0), ${M.MOON});
      glow = I * 0.45; top = 2.0;
    }
  } else {
    float halo = exp(-(mr - 1.0) * 1.7) * uMoon * (1.0 - cover * 0.6);
    if (gi == 0.0) col = vec3(0.6, 0.68, 0.85);
    glow = max(glow, halo * 0.2);
  }

  // aurora: three curtains, hanging "down" into the water
  if (uAurora > 0.002) {
    float A = 0.0;
    vec3 ac = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float axx = sc.x * (0.07 + 0.02 * fk) + uTime * (0.025 + 0.01 * fk) + fk * 2.1;
      float cy = sin(axx * 1.9 + sin(axx * 0.7) * 1.4) * (1.8 + fk * 0.6) + sin(axx * 4.3 + fk) * 0.5 + (fk - 1.0) * 5.6 + 1.5;
      float yy = cy - sc.y;
      float c = smoothstep(-0.35, 0.25, yy) * exp(-max(yy, 0.0) * (0.4 + 0.1 * fk));
      float rays = 0.5 + 0.5 * sin(sc.x * (2.3 + fk * 0.9) + sin(uTime * 0.6 + sc.x * 0.25 + fk) * 2.5);
      rays = mix(0.42, 1.0, rays) * (0.7 + 0.3 * vnoise(vec2(sc.x * 0.9 + fk * 9.0, uTime * 0.35)));
      float I = c * rays;
      A += I;
      ac += mix(vec3(0.2, 1.0, 0.62), vec3(0.52, 0.42, 1.0), smoothstep(0.5, 5.0, yy)) * I;
    }
    float I = A * uAurora * (1.0 - cover * 0.6);
    if (I > 0.07 && I > top * 0.8) {
      col = ac / max(A, 1e-3) * (0.45 + 0.55 * clamp(I, 0.0, 1.0));
      gi = lut(int(clamp(I * 14.0, 0.0, 15.0)) * 4 + int(hash21(cell) * 4.0), ${M.AURORA});
      glow = max(glow, clamp(I, 0.0, 1.0) * 0.55);
    } else if (I > 0.02) {
      if (gi == 0.0) col = ac / max(A, 1e-3);
      glow = max(glow, I * 0.5);
    }
  }
  oCol = vec4(col, clamp(glow, 0.0, 1.0));
  oGly = vec4(gi / 255.0, 0.0, 0.0, 1.0);
}`;

  /* ---------------------------------------------------------------- soft glow behind the text */
  SH.blurFS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uPre;
out vec4 o;
vec3 tap(vec2 uv) { vec4 c = texture(uTex, uv); return uPre > 0.5 ? c.rgb * c.a : c.rgb; }
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 s = tap(uv) * 0.2270270270;
  s += (tap(uv + uStep * 1.3846153846) + tap(uv - uStep * 1.3846153846)) * 0.3162162162;
  s += (tap(uv + uStep * 3.2307692308) + tap(uv - uStep * 3.2307692308)) * 0.0702702703;
  o = vec4(s, 1.0);
}`;

  /* ---------------------------------------------------------------- print it */
  SH.compFS = HEAD + `
uniform sampler2D uCellCol;
uniform sampler2D uCellGly;
uniform sampler2D uSkyCol;
uniform sampler2D uSkyGly;
uniform sampler2D uGlowW;
uniform sampler2D uGlowS;
uniform sampler2D uAtlas;
uniform vec2 uRes;
uniform vec2 uCellPx;
uniform vec2 uFrac;
uniform vec2 uGridW;
uniform vec2 uGridS;
uniform vec2 uTile;
uniform vec2 uAtlasSize;
uniform float uPad;
uniform float uTime;
uniform float uFade;
uniform vec3 uBg;
out vec4 o;

float glyph(float idx, vec2 l) {
  float gi = floor(idx * 255.0 + 0.5);
  vec2 t = vec2(mod(gi, 16.0), floor(gi / 16.0));
  vec2 uv = (t * uTile + uPad + vec2(l.x, 1.0 - l.y) * uCellPx) / uAtlasSize;
  return texture(uAtlas, uv).r;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  // the world layer slides by a fraction of a cell, so the text scrolls smoothly yet never boils
  vec2 gw = px / uCellPx + uFrac;
  ivec2 cw = ivec2(floor(gw));
  vec4 cc = texelFetch(uCellCol, cw, 0);
  vec4 cg = texelFetch(uCellGly, cw, 0);
  float inkW = glyph(cg.r, fract(gw));
  // the sky layer is pinned to the screen
  vec2 gs = px / uCellPx;
  ivec2 cs = ivec2(floor(gs));
  vec4 sc = texelFetch(uSkyCol, cs, 0);
  vec4 sg = texelFetch(uSkyGly, cs, 0);
  float hasInk = step(0.5 / 255.0, cg.r);
  float inkS = glyph(sg.r, fract(gs)) * cg.g * (1.0 - hasInk);

  vec3 glow = texture(uGlowW, gw / uGridW).rgb * 1.5 + texture(uGlowS, gs / uGridS).rgb * cg.g * 1.3;
  vec3 col = uBg + glow + cc.rgb * cg.b;
  col += sc.rgb * inkS;
  col += cc.rgb * inkW * (1.0 + 0.6 * cc.a);

  vec2 q = px / uRes - 0.5;
  col *= mix(0.5, 1.0, 1.0 - smoothstep(0.32, 0.86, length(q * vec2(1.0, 1.08))));
  col += (hash21(px + fract(uTime) * 61.0) - 0.5) * 0.012;
  col = 1.0 - exp(-col * 1.35);
  o = vec4(col * uFade, 1.0);
}`;
})();
