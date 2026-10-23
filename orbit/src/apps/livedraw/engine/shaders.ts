/**
 * The GPU engine's shaders (GLSL ES 3.0). Colours are premultiplied everywhere. Canvas coordinates are
 * pixels from the top-left; every full-size pass samples by gl_FragCoord, so all targets share one
 * orientation and only reading back to a 2D canvas flips rows.
 */

/** A full-size quad (clip space). */
export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/** One quad per dab (instanced), turned and squashed; uv 0..1 across the tip. */
export const DAB_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_dab;   // x px, y px, diameter px, angle
layout(location=2) in vec3 a_dab2;  // alpha, roundness, random
uniform vec2 u_res;
out vec2 v_uv;
out float v_alpha;
out float v_rad;
out float v_r;
void main() {
  float c = cos(a_dab.w);
  float s = sin(a_dab.w);
  vec2 local = a_corner * vec2(a_dab.z, a_dab.z * a_dab2.y);
  vec2 p = a_dab.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  v_uv = a_corner + 0.5;
  v_alpha = a_dab2.x;
  v_rad = a_dab.z * 0.5 * a_dab2.y;
  v_r = a_dab2.z;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const TIP = `
uniform int u_round;
uniform float u_hard;
uniform sampler2D u_tip;
float tipAlpha(vec2 uv, float rad) {
  if (u_round == 1) {
    float d = length(uv - 0.5) * 2.0;
    float inner = min(u_hard * 0.985, 1.0 - 1.5 / max(rad, 1.0));
    return 1.0 - smoothstep(max(inner, 0.0), 1.0, d);
  }
  return texture(u_tip, uv).a;
}`;

export const DAB_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
in float v_rad;
in float v_r;
uniform vec3 u_color;
uniform float u_alphaMul;
uniform sampler2D u_grain;
uniform float u_grainPx;
uniform float u_grainDepth;
uniform sampler2D u_dual;
uniform float u_dualPx;
uniform float u_dualDepth;
${TIP}
out vec4 o;
void main() {
  float a = tipAlpha(v_uv, v_rad);
  if (u_grainDepth > 0.0) a *= mix(1.0, texture(u_grain, gl_FragCoord.xy / u_grainPx).a, u_grainDepth);
  if (u_dualDepth > 0.0) a *= mix(1.0, texture(u_dual, gl_FragCoord.xy / u_dualPx + v_r * 7.13).a, u_dualDepth);
  a *= v_alpha * u_alphaMul;
  o = vec4(u_color * a, a);
}`;

/** A stroke's effect on what it lands on (also used for the live preview). */
const APPLY = `
vec4 applyStroke(vec4 L, vec4 S, float op, int mode) {
  float sa = S.a * op;
  if (mode == 1) return L * (1.0 - sa);
  if (mode == 2) {
    vec3 lc = L.a > 0.0 ? L.rgb / L.a : vec3(0.0);
    vec3 sc = S.a > 0.0 ? S.rgb / S.a : vec3(0.0);
    return vec4(mix(lc, sc, sa) * L.a, L.a);
  }
  return S * op + L * (1.0 - sa);
}`;

export const BAKE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_dst;
uniform sampler2D u_stroke;
uniform float u_opacity;
uniform int u_mode;
uniform vec2 u_res;
${APPLY}
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  o = applyStroke(texture(u_dst, uv), texture(u_stroke, uv), u_opacity, u_mode);
}`;

const BLEND = `
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  if (mx <= mn) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
float hardLight(float b, float s) { return s <= 0.5 ? b * 2.0 * s : b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0); }
float softLight(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float dodge(float b, float s) { return b <= 0.0 ? 0.0 : s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)); }
float burn(float b, float s) { return b >= 1.0 ? 1.0 : s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s); }
vec3 blendRgb(int m, vec3 b, vec3 s) {
  if (m == 1) return b * s;
  if (m == 2) return b + s - b * s;
  if (m == 3) return vec3(hardLight(s.r, b.r), hardLight(s.g, b.g), hardLight(s.b, b.b));
  if (m == 4) return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
  if (m == 5) return vec3(hardLight(b.r, s.r), hardLight(b.g, s.g), hardLight(b.b, s.b));
  if (m == 6) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
  if (m == 7) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
  if (m == 8) return min(b, s);
  if (m == 9) return max(b, s);
  if (m == 10) return abs(b - s);
  if (m == 11) return b + s - 2.0 * b * s;
  if (m == 12) return setLum(setSat(s, sat(b)), lum(b));
  if (m == 13) return setLum(setSat(b, sat(s)), lum(b));
  if (m == 14) return setLum(s, lum(b));
  if (m == 15) return setLum(b, lum(s));
  if (m == 16) return min(vec3(1.0), b + s);
  return s;
}
vec4 blendOver(vec4 B, vec4 S, int m) {
  if (S.a <= 0.0) return B;
  float ab = B.a;
  vec3 cb = ab > 0.0 ? B.rgb / ab : vec3(0.0);
  vec3 cs = S.rgb / S.a;
  vec3 mixed = m == 0 ? cs : clamp(blendRgb(m, cb, cs), 0.0, 1.0);
  vec3 c = (1.0 - ab) * cs + ab * mixed;
  return vec4(S.a * c + (1.0 - S.a) * B.rgb, S.a + ab * (1.0 - S.a));
}`;

export const COMP_FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform sampler2D u_acc;
uniform sampler2D u_layer;
uniform sampler2D u_mask;
uniform sampler2D u_clip;
uniform sampler2D u_clipMask;
uniform sampler2D u_stroke;
uniform float u_opacity;
uniform int u_blend;
uniform int u_hasMask;
uniform int u_hasClip;
uniform int u_clipHasMask;
uniform int u_stroke_on;
uniform int u_strokeToMask;
uniform int u_strokeMode;
uniform float u_strokeOpacity;
${APPLY}
${BLEND}
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 B = texture(u_acc, uv);
  vec4 L = texture(u_layer, uv);
  if (u_stroke_on == 1 && u_strokeToMask == 0) L = applyStroke(L, texture(u_stroke, uv), u_strokeOpacity, u_strokeMode);
  float m = 1.0;
  if (u_hasMask == 1) {
    vec4 M = texture(u_mask, uv);
    if (u_stroke_on == 1 && u_strokeToMask == 1) M = applyStroke(M, texture(u_stroke, uv), u_strokeOpacity, u_strokeMode);
    m = 1.0 - M.a;
  }
  float c = 1.0;
  if (u_hasClip == 1) {
    c = texture(u_clip, uv).a;
    if (u_clipHasMask == 1) c *= 1.0 - texture(u_clipMask, uv).a;
  }
  o = blendOver(B, L * (u_opacity * m * c), u_blend);
}`;

/** A texture drawn at the size of the target (scaled): copies, pictures, read-backs. */
export const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_alpha;
out vec4 o;
void main() { o = texture(u_tex, gl_FragCoord.xy / u_res) * u_alpha; }`;

/** Smudge: what is under the dab mixed toward the paint picked up just before it. */
export const SMUDGE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
in float v_rad;
in float v_r;
uniform vec2 u_res;
uniform sampler2D u_dst;
uniform sampler2D u_pickup;
uniform vec2 u_center;
uniform float u_size;
uniform float u_strength;
${TIP}
out vec4 o;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 puv = (frag - u_center) / u_size + 0.5;
  puv.y = 1.0 - puv.y;
  vec4 L = texture(u_dst, gl_FragCoord.xy / u_res);
  vec4 P = texture(u_pickup, puv);
  float a = tipAlpha(v_uv, v_rad) * u_strength * v_alpha;
  o = mix(L, P, a);
}`;
