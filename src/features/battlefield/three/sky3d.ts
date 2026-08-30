import * as THREE from "three";

import { goldenness, nightness } from "@/lib/battle/time";

/**
 * Sky keyframes. Franklin on November 30, 1864 was clear and unseasonably
 * warm; sunset came at 4:33 PM and the moon was two days past new, so the
 * night sky is starlight only — no moon, by the record.
 */
const ZENITH_DAY = new THREE.Color(0x3d6d9c);
const ZENITH_GOLD = new THREE.Color(0x2f5f8e);
const ZENITH_NIGHT = new THREE.Color(0x040611);

const HORIZON_DAY = new THREE.Color(0xc7d6e2);
const HORIZON_GOLD = new THREE.Color(0xf0a355);
const HORIZON_NIGHT = new THREE.Color(0x0b0f1d);

const SUN_DAY = new THREE.Color(0xfff4dc);
const SUN_GOLD = new THREE.Color(0xff9840);

const GROUND_DAY = new THREE.Color(0xa9a086);
const GROUND_NIGHT = new THREE.Color(0x05070e);

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;

void main() {
  // The dome is re-centered on the camera every frame, so the local position
  // is already the view direction.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vDir;

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
uniform float uGolden;
uniform float uTime;
uniform float uCloud;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    total += valueNoise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

/** One star per occupied cell of a direction-space lattice, with twinkle. */
float starField(vec3 dir, float scale, float threshold, float time) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  vec3 f = fract(p);

  float pick = hash13(cell);
  float present = step(threshold, pick);

  vec3 center = vec3(
    hash13(cell + 17.0),
    hash13(cell + 41.0),
    hash13(cell + 73.0)
  );

  float d = length(f - center);
  float core = smoothstep(0.22, 0.0, d);
  float magnitude = (pick - threshold) / max(1.0 - threshold, 0.001);
  float twinkle = 0.72 + 0.28 * sin(time * 1.9 + pick * 96.0);

  return present * core * (0.25 + 0.75 * magnitude * magnitude) * twinkle;
}

void main() {
  vec3 dir = normalize(vDir);
  float height = dir.y;

  // Base gradient, compressed toward the horizon the way real sky is.
  float t = clamp(height, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(t, 0.42));

  // Below the horizon line the dome reads as distant ground haze.
  color = mix(color, uGround, smoothstep(0.0, -0.14, height));

  float cosSun = dot(dir, uSunDir);
  float aboveHorizon = smoothstep(-0.06, 0.02, uSunDir.y);

  // Warm scatter around the sun, strongest low in the sky at golden hour.
  float wide = pow(max(cosSun, 0.0), 5.0);
  float tight = pow(max(cosSun, 0.0), 90.0);
  float scatter = wide * (0.22 + 0.55 * uGolden) + tight * 0.8;
  color += uSunColor * scatter * (1.0 - uNight) * aboveHorizon;

  // The disk itself. The sun subtends about half a degree, so the edge sits
  // at 0.0047 rad; it reddens on its own because uSunColor does.
  float angle = acos(clamp(cosSun, -1.0, 1.0));
  float disk = 1.0 - smoothstep(0.0040, 0.0068, angle);
  color = mix(color, uSunColor * (1.9 - 0.55 * uGolden), disk * aboveHorizon * (1.0 - uNight));

  // Afterglow: a warm bar hugging the horizon on the sun's side once the
  // disk is down, which is what the field actually looked like at 5 PM.
  float horizonBand = exp(-pow(height / 0.10, 2.0));
  // Compass alignment between the view and the sun, ignoring elevation.
  vec2 sunAz = normalize(vec2(uSunDir.x, uSunDir.z) + vec2(1e-5));
  vec2 viewAz = normalize(vec2(dir.x, dir.z) + vec2(1e-5));
  float azAlign = dot(sunAz, viewAz);
  float sunSide = pow(max(azAlign, 0.0), 3.0);
  color += uSunColor * horizonBand * sunSide * uGolden * 0.55;

  // The twilight wedge: opposite the setting sun the earth's own shadow
  // climbs the eastern sky under a rose Belt of Venus. It is the reason the
  // field went dark so fast with the sun still glowing behind the hills.
  float antiSun = pow(max(-azAlign, 0.0), 2.0);
  float belt = exp(-pow((height - 0.10) / 0.09, 2.0));
  float shadow = exp(-pow(height / 0.06, 2.0));
  color = mix(color, color + vec3(0.20, 0.09, 0.11), belt * antiSun * uGolden * 0.9);
  color = mix(color, color * vec3(0.55, 0.60, 0.78), shadow * antiSun * uGolden * 0.8);

  // High cirrus, drawn in streaks the way wind-sheared ice cloud runs.
  if (uCloud > 0.001 && height > 0.0) {
    vec2 cloudUv = dir.xz / max(height + 0.16, 0.06) * 0.5;
    float sheet = fbm(cloudUv * vec2(0.85, 2.6) + vec2(uTime * 0.005, 0.0));
    float mask = smoothstep(0.56, 0.82, sheet) * smoothstep(0.0, 0.26, height);
    // Sunlit white by day, underlit at sunset, and all but black after it.
    vec3 lit = mix(vec3(1.0, 0.98, 0.94), uSunColor * 1.2, uGolden);
    lit = mix(lit, uZenith * 1.35, uNight);
    color = mix(color, lit, mask * uCloud);
  }

  // Stars: two lattices so magnitudes vary, plus the Milky Way. Franklin in
  // 1864 had no sky glow for a hundred miles — the band was plainly visible.
  if (uNight > 0.01) {
    float stars = starField(dir, 210.0, 0.955, uTime) * 0.85
      + starField(dir, 96.0, 0.986, uTime * 0.7) * 1.8;

    // The band is tilted off the vertical so it reads as a real great circle.
    vec3 galacticAxis = normalize(vec3(0.62, 0.46, -0.64));
    float band = exp(-pow(dot(dir, galacticAxis) / 0.26, 2.0));
    float dust = fbm(dir.xz * 3.2 + dir.y * 2.0) * 0.7 + 0.35;
    float rift = smoothstep(0.30, 0.62, fbm(dir.xz * 1.7 + 9.0));
    vec3 milkyWay = vec3(0.46, 0.50, 0.66) * band * dust * rift * 0.30;

    // Stars wash out near the horizon and behind any remaining afterglow.
    float extinction = smoothstep(-0.02, 0.18, height);
    float visible = uNight * uNight * extinction;
    color += (vec3(0.94, 0.95, 1.0) * stars + milkyWay) * visible;
  }

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export interface SkyState {
  /** Unit vector toward the sun in world space. */
  sunDirection: THREE.Vector3;
  /** Horizon color, for matching scene fog. */
  horizonColor: THREE.Color;
  /** Zenith color, for matching ambient sky light. */
  zenithColor: THREE.Color;
  /** Warm sunlight tint at the current hour. */
  sunColor: THREE.Color;
  night: number;
  golden: number;
}

/**
 * A camera-locked sky dome: gradient, sun disk and scatter, sunset afterglow,
 * cirrus, and a star field that comes up as the battle runs into darkness.
 */
export class Sky3D {
  readonly mesh: THREE.Mesh;
  readonly state: SkyState = {
    sunDirection: new THREE.Vector3(0, 1, 0),
    horizonColor: new THREE.Color(),
    zenithColor: new THREE.Color(),
    sunColor: new THREE.Color(),
    night: 0,
    golden: 0,
  };

  private material: THREE.ShaderMaterial;
  private geometry: THREE.SphereGeometry;
  private elapsed = 0;

  constructor(radius = 12000) {
    this.geometry = new THREE.SphereGeometry(radius, 48, 32);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(ZENITH_DAY) },
        uHorizon: { value: new THREE.Color(HORIZON_DAY) },
        uGround: { value: new THREE.Color(GROUND_DAY) },
        uSunColor: { value: new THREE.Color(SUN_DAY) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uGolden: { value: 0 },
        uTime: { value: 0 },
        uCloud: { value: 0.5 },
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "sky-dome";
    this.mesh.frustumCulled = false;
    // Painted first, with depth off, so everything else draws over it.
    this.mesh.renderOrder = -1000;
  }

  /**
   * Sun position for the battle hour. The disk tracks WSW down to the horizon
   * at 4:33 PM and keeps sinking after, which drives the afterglow.
   */
  private sunDirectionAt(timeMs: number, out: THREE.Vector3): THREE.Vector3 {
    const hour = ((timeMs / 3_600_000 - 6) % 24 + 24) % 24;
    // 12:00 -> 30° above the horizon (late-November sun), 16:55 -> below it.
    const altitudeDeg = 30 - (hour - 12) * 6.6;
    const altitude = (altitudeDeg * Math.PI) / 180;
    // Azimuth swings from a little west of south toward WSW.
    const azimuthDeg = 196 + (hour - 12) * 8.5;
    const azimuth = (azimuthDeg * Math.PI) / 180;

    // World axes: +x east, +y up, +z south. Azimuth is measured from north,
    // clockwise through east.
    const horizontal = Math.cos(altitude);
    return out
      .set(
        horizontal * Math.sin(azimuth),
        Math.sin(altitude),
        -horizontal * Math.cos(azimuth),
      )
      .normalize();
  }

  /** Advance the sky to the battle clock; keeps the dome on the camera. */
  update(timeMs: number, deltaMs: number, cameraPosition: THREE.Vector3, reducedMotion: boolean) {
    this.elapsed += reducedMotion ? 0 : deltaMs / 1000;

    const night = nightness(timeMs);
    const golden = goldenness(timeMs);
    const uniforms = this.material.uniforms;

    const zenith = uniforms.uZenith.value as THREE.Color;
    zenith.copy(ZENITH_DAY).lerp(ZENITH_GOLD, golden).lerp(ZENITH_NIGHT, night);

    const horizon = uniforms.uHorizon.value as THREE.Color;
    horizon.copy(HORIZON_DAY).lerp(HORIZON_GOLD, Math.min(1, golden * 1.15)).lerp(HORIZON_NIGHT, night);

    const ground = uniforms.uGround.value as THREE.Color;
    ground.copy(GROUND_DAY).lerp(GROUND_NIGHT, night);

    const sunColor = uniforms.uSunColor.value as THREE.Color;
    sunColor.copy(SUN_DAY).lerp(SUN_GOLD, Math.min(1, golden * 1.3));

    const sunDir = this.sunDirectionAt(timeMs, uniforms.uSunDir.value as THREE.Vector3);

    uniforms.uNight.value = night;
    uniforms.uGolden.value = golden;
    uniforms.uTime.value = this.elapsed;

    this.mesh.position.copy(cameraPosition);

    this.state.sunDirection.copy(sunDir);
    this.state.horizonColor.copy(horizon);
    this.state.zenithColor.copy(zenith);
    this.state.sunColor.copy(sunColor);
    this.state.night = night;
    this.state.golden = golden;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
