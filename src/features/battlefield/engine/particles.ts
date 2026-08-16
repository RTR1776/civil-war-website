import type { CameraController, Viewport } from "@/features/battlefield/engine/camera";
import { createRng, type Rng } from "@/features/battlefield/engine/rand";

interface SmokePuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  sizeM: number;
  tone: number;
}

interface MuzzleFlash {
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
  sizeM: number;
}

const MAX_SMOKE = 150;
const MAX_FLASH = 70;
// Light southwest breeze pushing powder smoke across the works.
const WIND_X = 1.9;
const WIND_Y = -1.1;

function makeSprite(size: number, stops: Array<[number, string]>): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (!ctx) {
    return null;
  }

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

export class BattleParticles {
  private smoke: SmokePuff[] = [];
  private flashes: MuzzleFlash[] = [];
  private rng: Rng = createRng(0xf4a1);
  private smokeSprite = makeSprite(64, [
    [0, "rgba(236, 230, 218, 0.55)"],
    [0.55, "rgba(214, 205, 188, 0.28)"],
    [1, "rgba(200, 192, 176, 0)"],
  ]);
  private glowSprite = makeSprite(64, [
    [0, "rgba(255, 214, 140, 0.95)"],
    [0.32, "rgba(255, 156, 64, 0.5)"],
    [1, "rgba(255, 110, 30, 0)"],
  ]);

  /** Spawn ambient smoke around an engaged front. */
  spawnSmoke(x: number, y: number, intensity: number) {
    if (this.smoke.length >= MAX_SMOKE) {
      return;
    }

    const rng = this.rng;
    this.smoke.push({
      x: x + (rng() - 0.5) * 200,
      y: y + (rng() - 0.5) * 130,
      vx: WIND_X * (0.7 + rng() * 0.7),
      vy: WIND_Y * (0.7 + rng() * 0.7) - rng() * 0.5,
      ageMs: 0,
      lifeMs: 5200 + rng() * 4200,
      sizeM: 44 + rng() * 70 * intensity,
      tone: rng(),
    });
  }

  spawnFlash(x: number, y: number, spreadM: number) {
    if (this.flashes.length >= MAX_FLASH) {
      return;
    }

    const rng = this.rng;
    const along = (rng() - 0.5) * spreadM;
    const across = (rng() - 0.5) * 26;
    this.flashes.push({
      x: x + along,
      y: y + across,
      ageMs: 0,
      lifeMs: 90 + rng() * 130,
      sizeM: 9 + rng() * 12,
    });
  }

  update(dtMs: number) {
    const dtSec = dtMs / 1000;

    for (let index = this.smoke.length - 1; index >= 0; index -= 1) {
      const puff = this.smoke[index];
      puff.ageMs += dtMs;
      if (puff.ageMs >= puff.lifeMs) {
        this.smoke.splice(index, 1);
        continue;
      }
      puff.x += puff.vx * dtSec * 14;
      puff.y += puff.vy * dtSec * 14;
      puff.sizeM += dtSec * 16;
    }

    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      const flash = this.flashes[index];
      flash.ageMs += dtMs;
      if (flash.ageMs >= flash.lifeMs) {
        this.flashes.splice(index, 1);
      }
    }
  }

  clear() {
    this.smoke.length = 0;
    this.flashes.length = 0;
  }

  drawSmoke(ctx: CanvasRenderingContext2D, camera: CameraController, viewport: Viewport, nightAmount: number) {
    if (!this.smokeSprite) {
      return;
    }

    for (const puff of this.smoke) {
      const progress = puff.ageMs / puff.lifeMs;
      const fade = progress < 0.18 ? progress / 0.18 : 1 - (progress - 0.18) / 0.82;
      const screen = camera.worldToScreen(puff, viewport);
      const sizePx = puff.sizeM * camera.current.scale;
      if (sizePx < 3 || screen.x < -sizePx || screen.y < -sizePx
        || screen.x > viewport.width + sizePx || screen.y > viewport.height + sizePx) {
        continue;
      }

      ctx.globalAlpha = fade * (0.34 - nightAmount * 0.16) * (0.6 + puff.tone * 0.4);
      ctx.drawImage(this.smokeSprite, screen.x - sizePx / 2, screen.y - sizePx / 2, sizePx, sizePx);
    }
    ctx.globalAlpha = 1;
  }

  drawFlashes(ctx: CanvasRenderingContext2D, camera: CameraController, viewport: Viewport, nightAmount: number) {
    if (!this.glowSprite) {
      return;
    }

    const previousComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "screen";

    for (const flash of this.flashes) {
      const progress = flash.ageMs / flash.lifeMs;
      const fade = progress < 0.25 ? progress / 0.25 : 1 - (progress - 0.25) / 0.75;
      const screen = camera.worldToScreen(flash, viewport);
      // At night each shot blooms far beyond the muzzle.
      const bloom = 1 + nightAmount * 5.5;
      const sizePx = flash.sizeM * bloom * camera.current.scale;
      if (screen.x < -sizePx || screen.y < -sizePx
        || screen.x > viewport.width + sizePx || screen.y > viewport.height + sizePx) {
        continue;
      }

      ctx.globalAlpha = fade * (0.5 + nightAmount * 0.5);
      ctx.drawImage(this.glowSprite, screen.x - sizePx / 2, screen.y - sizePx / 2, sizePx, sizePx);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previousComposite;
  }

  get smokeCount(): number {
    return this.smoke.length;
  }
}
