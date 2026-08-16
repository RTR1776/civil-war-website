import * as THREE from "three";

import { createRng } from "@/features/battlefield/engine/rand";
import type { FrontPoint } from "@/features/battlefield/three/armies3d";

const MUSKET_POOL = 260;
const CANNON_POOL = 40;
const SMOKE_POOL = 340;
const HIDDEN_Y = -4000;

interface SmokeParticle {
  slot: number;
  x: number;
  y: number;
  z: number;
  ageMs: number;
  lifeMs: number;
}

interface FlashParticle {
  index: number;
  ageMs: number;
  lifeMs: number;
}

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class FlashPool {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private live: FlashParticle[] = [];
  private freeIndices: number[] = [];
  private material: THREE.PointsMaterial;

  constructor(capacity: number, size: number, texture: THREE.Texture) {
    this.positions = new Float32Array(capacity * 3);
    for (let index = 0; index < capacity; index += 1) {
      this.positions[index * 3 + 1] = HIDDEN_Y;
      this.freeIndices.push(index);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    this.material = new THREE.PointsMaterial({
      size,
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, lifeMs: number) {
    const index = this.freeIndices.pop();
    if (index === undefined) {
      return;
    }

    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
    this.live.push({ index, ageMs: 0, lifeMs });
  }

  update(dtMs: number, nightAmount: number, sizeBase: number) {
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const particle = this.live[index];
      particle.ageMs += dtMs;
      if (particle.ageMs >= particle.lifeMs) {
        this.positions[particle.index * 3 + 1] = HIDDEN_Y;
        this.freeIndices.push(particle.index);
        this.live.splice(index, 1);
      }
    }

    this.material.size = sizeBase * (1 + nightAmount * 2.1);
    this.material.opacity = 0.55 + nightAmount * 0.45;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Battle atmosphere: musket flashes rippling along engaged fronts, cannon
 * discharges at the batteries, and powder smoke drifting north-east. Flash
 * brightness and size swell as darkness falls — the night fight is lit by
 * musketry.
 */
export class Effects3D {
  readonly group = new THREE.Group();

  private muskets: FlashPool;
  private cannons: FlashPool;
  private smokePoints: THREE.Points;
  private smokeMaterial: THREE.PointsMaterial;
  private smokePositions: Float32Array;
  private smoke: SmokeParticle[] = [];
  private smokeFree: number[] = [];
  private rng = createRng(0xeff3);
  private cannonClock = 0;
  private textures: THREE.Texture[] = [];

  constructor() {
    const flashTexture = glowTexture("rgba(255, 224, 160, 1)", "rgba(255, 120, 30, 0)");
    const cannonTexture = glowTexture("rgba(255, 240, 200, 1)", "rgba(255, 150, 40, 0)");
    const smokeTexture = glowTexture("rgba(214, 210, 200, 0.55)", "rgba(200, 196, 188, 0)");
    this.textures.push(flashTexture, cannonTexture, smokeTexture);

    this.muskets = new FlashPool(MUSKET_POOL, 7, flashTexture);
    this.cannons = new FlashPool(CANNON_POOL, 26, cannonTexture);
    this.group.add(this.muskets.points);
    this.group.add(this.cannons.points);

    this.smokePositions = new Float32Array(SMOKE_POOL * 3);
    for (let index = 0; index < SMOKE_POOL; index += 1) {
      this.smokePositions[index * 3 + 1] = HIDDEN_Y;
      this.smokeFree.push(index);
    }

    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute("position", new THREE.BufferAttribute(this.smokePositions, 3));
    smokeGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.smokeMaterial = new THREE.PointsMaterial({
      size: 19,
      map: smokeTexture,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.smokePoints = new THREE.Points(smokeGeometry, this.smokeMaterial);
    this.smokePoints.frustumCulled = false;
    this.group.add(this.smokePoints);
  }

  /**
   * Advance particles and spawn new fire along the engaged fronts.
   * `intensity` is the 0..1 casualty-rate signal; `gunSlots` are cannon
   * muzzle positions (Union guns fire while any front is active).
   */
  update(
    dtMs: number,
    fronts: FrontPoint[],
    gunSlots: Array<{ x: number; y: number; heading: number }>,
    groundHeight: (x: number, y: number) => number,
    intensity: number,
    nightAmount: number,
    reducedMotion: boolean,
  ) {
    const rng = this.rng;

    if (!reducedMotion) {
      for (const front of fronts) {
        const shots = intensity * 2.4 * (dtMs / 100);
        const count = Math.floor(shots) + (rng() < shots % 1 ? 1 : 0);

        for (let shot = 0; shot < count; shot += 1) {
          const along = (rng() - 0.5) * front.frontage;
          const x = front.x - Math.sin(front.heading) * along;
          const z = front.z + Math.cos(front.heading) * along;
          this.muskets.spawn(x, groundHeight(x, z) + 1.7, z, 90 + rng() * 120);

          if (rng() < 0.24) {
            this.spawnSmoke(x, groundHeight(x, z) + 3.2, z);
          }
        }
      }

      // Batteries fire in slow rolling sequence while the fight is on.
      this.cannonClock -= dtMs;
      if (fronts.length > 0 && intensity > 0.08 && this.cannonClock <= 0) {
        this.cannonClock = 420 - intensity * 260 + rng() * 300;
        const slot = gunSlots[Math.floor(rng() * gunSlots.length)];
        if (slot) {
          const muzzleX = slot.x + Math.cos(slot.heading) * 3.4;
          const muzzleZ = slot.y + Math.sin(slot.heading) * 3.4;
          const muzzleY = groundHeight(slot.x, slot.y) + 2.1;
          this.cannons.spawn(muzzleX, muzzleY, muzzleZ, 200 + rng() * 130);
          for (let puff = 0; puff < 3; puff += 1) {
            this.spawnSmoke(
              muzzleX + (rng() - 0.5) * 8,
              muzzleY + 2 + rng() * 3,
              muzzleZ + (rng() - 0.5) * 8,
            );
          }
        }
      }
    }

    // Smoke drift: light breeze toward the north-east.
    const dtSec = dtMs / 1000;
    for (let index = this.smoke.length - 1; index >= 0; index -= 1) {
      const particle = this.smoke[index];
      particle.ageMs += dtMs;

      if (particle.ageMs >= particle.lifeMs) {
        this.smokePositions[particle.slot * 3 + 1] = HIDDEN_Y;
        this.smokeFree.push(particle.slot);
        this.smoke.splice(index, 1);
        continue;
      }

      particle.x += 2.6 * dtSec * 6;
      particle.z -= 1.4 * dtSec * 6;
      particle.y += 1.1 * dtSec * 6;
      this.smokePositions[particle.slot * 3] = particle.x;
      this.smokePositions[particle.slot * 3 + 1] = particle.y;
      this.smokePositions[particle.slot * 3 + 2] = particle.z;
    }

    this.smokeMaterial.opacity = Math.max(0.08, 0.28 - nightAmount * 0.16);
    (this.smokePoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    this.muskets.update(dtMs, nightAmount, 7);
    this.cannons.update(dtMs, nightAmount, 26);
  }

  private spawnSmoke(x: number, y: number, z: number) {
    const slot = this.smokeFree.pop();
    if (slot === undefined) {
      return;
    }

    this.smokePositions[slot * 3] = x;
    this.smokePositions[slot * 3 + 1] = y;
    this.smokePositions[slot * 3 + 2] = z;
    this.smoke.push({ slot, x, y, z, ageMs: 0, lifeMs: 4200 + this.rng() * 3600 });
  }

  dispose() {
    this.muskets.dispose();
    this.cannons.dispose();
    this.smokePoints.geometry.dispose();
    this.smokeMaterial.dispose();
    for (const texture of this.textures) {
      texture.dispose();
    }
  }
}
