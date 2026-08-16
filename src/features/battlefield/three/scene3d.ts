import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { WorldPoint } from "@/features/battlefield/engine/projection";
import { createRng, randBetween } from "@/features/battlefield/engine/rand";
import { TerrainModel } from "@/features/battlefield/three/heightfield";
import { goldenness, nightness } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

export interface BatteryDef {
  point: WorldPoint;
  guns: number;
  side: "Union" | "Confederate";
}

interface PaintablePath {
  points: WorldPoint[];
  styleKey: string;
  category: string;
}

const TERRAIN_SEGMENTS_X = 240;
const TERRAIN_SEGMENTS_Y = 120;

function samplePolyline(points: WorldPoint[], stepM: number): Array<{ point: WorldPoint; heading: number }> {
  const samples: Array<{ point: WorldPoint; heading: number }> = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const steps = Math.max(1, Math.floor(length / stepM));

    for (let step = 0; step < steps; step += 1) {
      const blend = (step + 0.5) / steps;
      samples.push({
        point: { x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend },
        heading,
      });
    }
  }

  return samples;
}

/**
 * The static 3D world: terrain, water, works, buildings, trees, fort, sky and
 * lights. Armies and effects are layered on top by their own modules.
 */
export class BattlefieldWorld {
  readonly group = new THREE.Group();
  readonly terrainModel: TerrainModel;
  readonly batteries: BatteryDef[] = [];
  readonly worksPaths: WorldPoint[][] = [];

  private sun: THREE.DirectionalLight;
  private hemisphere: THREE.HemisphereLight;
  private lanternLights: THREE.PointLight[] = [];
  private skyColor = new THREE.Color();
  private disposables: Array<{ dispose(): void }> = [];

  constructor(private bundle: ScenarioDataBundle, private scene: THREE.Scene) {
    this.terrainModel = new TerrainModel(bundle);

    const roads: PaintablePath[] = [];
    let townRing: WorldPoint[] | null = null;
    const buildingsAnchors: Array<{ point: WorldPoint; large: boolean }> = [];
    let fortPoint: WorldPoint | null = null;

    for (const feature of bundle.mapLayerPack.features) {
      const props = feature.properties;

      if (feature.geometry.type === "LineString") {
        const points = feature.geometry.coordinates.map(([lng, lat]) =>
          this.terrainModel.projection.toWorld(lat, lng),
        );

        if (props.category === "works") {
          this.worksPaths.push(points);
        } else if (props.category !== "river") {
          roads.push({ points, styleKey: props.styleKey, category: props.category });
        }
        continue;
      }

      if (feature.geometry.type === "Polygon" && props.styleKey === "town-core") {
        townRing = feature.geometry.coordinates[0].map(([lng, lat]) =>
          this.terrainModel.projection.toWorld(lat, lng),
        );
        continue;
      }

      if (feature.geometry.type === "Point") {
        const [lng, lat] = feature.geometry.coordinates;
        const world = this.terrainModel.projection.toWorld(lat, lng);

        if (props.styleKey === "battery") {
          const guns = typeof (props as unknown as { guns?: unknown }).guns === "number"
            ? (props as unknown as { guns: number }).guns
            : 3;
          this.batteries.push({
            point: world,
            guns,
            side: props.id === "layer-battery-conf" ? "Confederate" : "Union",
          });
        } else if (props.styleKey === "fort") {
          fortPoint = world;
        } else if (props.category === "landmark") {
          buildingsAnchors.push({ point: world, large: true });
        }
      }
    }

    this.buildTerrain(roads, townRing);
    this.buildWater();
    this.buildWorks();
    this.buildBuildings(buildingsAnchors, townRing);
    this.buildTrees();
    if (fortPoint) {
      this.buildFort(fortPoint);
    }

    this.hemisphere = new THREE.HemisphereLight(0xcfd8e8, 0x6b6248, 0.9);
    this.scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(0xfff2dc, 1.6);
    this.sun.position.set(-1200, 1800, 900);
    this.scene.add(this.sun);

    // Lanterns at the Carter House and in town, for the night fight.
    const carter = this.terrainModel.projection.toWorld(35.9224, -86.8597);
    const town = this.terrainModel.projection.toWorld(35.9264, -86.868);
    for (const anchor of [carter, town]) {
      const light = new THREE.PointLight(0xffb45e, 0, 420, 1.6);
      light.position.set(anchor.x, this.terrainModel.elevation(anchor.x, anchor.y) + 8, anchor.y);
      this.lanternLights.push(light);
      this.scene.add(light);
    }

    this.scene.add(this.group);
    this.scene.fog = new THREE.FogExp2(0xd7cdb4, 0.00016);
  }

  groundHeight(x: number, y: number): number {
    return this.terrainModel.elevation(x, y);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  private buildTerrain(roads: PaintablePath[], townRing: WorldPoint[] | null) {
    const { widthM, heightM } = this.terrainModel.projection;
    const padded = 1.35;
    const width = widthM * padded;
    const depth = heightM * padded;

    const geometry = this.track(
      new THREE.PlaneGeometry(width, depth, TERRAIN_SEGMENTS_X, TERRAIN_SEGMENTS_Y),
    );
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      positions.setY(index, this.terrainModel.elevation(x, z));
    }
    geometry.computeVertexNormals();

    const texture = this.track(this.paintGroundTexture(width, depth, roads, townRing));
    const material = this.track(
      new THREE.MeshLambertMaterial({ map: texture }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "terrain";
    this.group.add(mesh);
  }

  private paintGroundTexture(
    width: number,
    depth: number,
    roads: PaintablePath[],
    townRing: WorldPoint[] | null,
  ): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = Math.round((2048 * depth) / width);
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    if (!ctx) {
      return texture;
    }

    const toU = (x: number) => ((x + width / 2) / width) * canvas.width;
    const toV = (y: number) => ((y + depth / 2) / depth) * canvas.height;
    const metersToPx = canvas.width / width;

    // Late-November farmland: browns, stubble-tan, dull green pasture.
    ctx.fillStyle = "#87805f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rng = createRng(0x3d1864);
    const palette = ["#9b9160", "#a8905a", "#6f7f4c", "#b3a068", "#5d6b44", "#8a7a52", "#7a8656"];
    for (let patch = 0; patch < 520; patch += 1) {
      ctx.save();
      ctx.translate(rng() * canvas.width, rng() * canvas.height);
      ctx.rotate(randBetween(rng, -0.4, 0.4));
      ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
      ctx.globalAlpha = randBetween(rng, 0.45, 0.9);
      ctx.fillRect(0, 0, randBetween(rng, 46, 200), randBetween(rng, 30, 120));
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Darker wooded band along the river.
    ctx.fillStyle = "#4e5a3c";
    const step = 34;
    for (let px = 0; px < canvas.width; px += 4) {
      for (let py = 0; py < canvas.height; py += 4) {
        if ((px + py) % step > 20) {
          continue;
        }
        const worldX = (px / canvas.width) * width - width / 2;
        const worldY = (py / canvas.height) * depth - depth / 2;
        const distance = this.terrainModel.riverDistance(worldX, worldY);
        if (distance > 46 && distance < 150) {
          ctx.globalAlpha = 0.55;
          ctx.fillRect(px, py, 5, 5);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Roads and rail.
    for (const road of roads) {
      ctx.strokeStyle = road.styleKey === "railroad" ? "#4a4238" : "#b7a578";
      ctx.lineWidth = Math.max(2.2, (road.styleKey === "road-primary" ? 11 : 8) * metersToPx);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      road.points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(toU(point.x), toV(point.y));
        } else {
          ctx.lineTo(toU(point.x), toV(point.y));
        }
      });
      ctx.stroke();
    }

    // Town footprint.
    if (townRing) {
      ctx.fillStyle = "#8a7a5f";
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      townRing.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(toU(point.x), toV(point.y));
        } else {
          ctx.lineTo(toU(point.x), toV(point.y));
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Scarred earth along the works.
    for (const path of this.worksPaths) {
      ctx.strokeStyle = "#5d4b33";
      ctx.lineWidth = Math.max(3, 16 * metersToPx);
      ctx.beginPath();
      path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(toU(point.x), toV(point.y));
        } else {
          ctx.lineTo(toU(point.x), toV(point.y));
        }
      });
      ctx.stroke();
    }

    texture.needsUpdate = true;
    return texture;
  }

  private buildWater() {
    const { widthM, heightM } = this.terrainModel.projection;
    const geometry = this.track(new THREE.PlaneGeometry(widthM * 1.4, heightM * 1.4));
    geometry.rotateX(-Math.PI / 2);
    const material = this.track(
      new THREE.MeshLambertMaterial({ color: 0x40566b, transparent: true, opacity: 0.94 }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = TerrainModel.WATER_LEVEL;
    mesh.name = "water";
    this.group.add(mesh);
  }

  private buildWorks() {
    const samples = this.worksPaths.flatMap((path) => samplePolyline(path, 13));
    if (samples.length === 0) {
      return;
    }

    const parapet = this.track(new THREE.BoxGeometry(14.5, 2.4, 5.2));
    const material = this.track(new THREE.MeshLambertMaterial({ color: 0x50412c }));
    const instanced = new THREE.InstancedMesh(parapet, material, samples.length);

    const headlog = this.track(new THREE.BoxGeometry(14.5, 0.5, 0.7));
    const headlogMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x33281a }));
    const headlogs = new THREE.InstancedMesh(headlog, headlogMaterial, samples.length);

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);

    samples.forEach((sample, index) => {
      const ground = this.terrainModel.elevation(sample.point.x, sample.point.y);
      quaternion.setFromAxisAngle(axisY, -sample.heading);

      matrix.compose(
        new THREE.Vector3(sample.point.x, ground + 1.1, sample.point.y),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      instanced.setMatrixAt(index, matrix);

      matrix.compose(
        new THREE.Vector3(sample.point.x, ground + 2.55, sample.point.y),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      headlogs.setMatrixAt(index, matrix);
    });

    instanced.name = "works";
    this.group.add(instanced);
    this.group.add(headlogs);
  }

  private buildBuildings(
    anchors: Array<{ point: WorldPoint; large: boolean }>,
    townRing: WorldPoint[] | null,
  ) {
    const base = this.track(new THREE.BoxGeometry(11, 5, 8));
    base.translate(0, 2.5, 0);
    const roof = this.track(new THREE.CylinderGeometry(4.6, 4.6, 11.6, 3, 1));
    roof.rotateZ(Math.PI / 2);
    roof.rotateX(Math.PI);
    roof.scale(1, 0.62, 1);
    roof.translate(0, 6.4, 0);
    const house = this.track(mergeGeometries([base, roof]));

    const positions: Array<{ x: number; y: number; scale: number; rotation: number }> = [];

    for (const anchor of anchors) {
      positions.push({ x: anchor.point.x, y: anchor.point.y, scale: 1.5, rotation: 0.2 });
    }

    if (townRing) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of townRing) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }

      const rng = createRng(0x7041);
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 8; col += 1) {
          if (rng() < 0.2) {
            continue;
          }
          positions.push({
            x: minX + ((col + 0.5) / 8) * (maxX - minX) + randBetween(rng, -10, 10),
            y: minY + ((row + 0.5) / 5) * (maxY - minY) + randBetween(rng, -8, 8),
            scale: randBetween(rng, 0.75, 1.2),
            rotation: rng() < 0.5 ? 0 : Math.PI / 2,
          });
        }
      }
    }

    const material = this.track(new THREE.MeshLambertMaterial({ color: 0xcfc4ae }));
    const instanced = new THREE.InstancedMesh(house, material, positions.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const paints = [0xd8cdb6, 0xb8a488, 0xc9b9a0, 0x9e8b72];
    const rng = createRng(0x9b);

    positions.forEach((slot, index) => {
      quaternion.setFromAxisAngle(axisY, slot.rotation);
      matrix.compose(
        new THREE.Vector3(slot.x, this.terrainModel.elevation(slot.x, slot.y), slot.y),
        quaternion,
        new THREE.Vector3(slot.scale, slot.scale, slot.scale),
      );
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, color.setHex(paints[Math.floor(rng() * paints.length)]));
    });

    instanced.name = "buildings";
    this.group.add(instanced);
  }

  private buildTrees() {
    const trunk = this.track(new THREE.CylinderGeometry(0.5, 0.7, 5, 5));
    trunk.translate(0, 2.5, 0);
    const canopy = this.track(new THREE.ConeGeometry(4.6, 11, 6));
    canopy.translate(0, 9.5, 0);
    const tree = this.track(mergeGeometries([trunk, canopy]));

    const { widthM, heightM } = this.terrainModel.projection;
    const rng = createRng(0x7ee5);
    const slots: Array<{ x: number; y: number; scale: number }> = [];

    // Timber along the Harpeth plus scattered field clumps.
    for (let attempt = 0; attempt < 4200 && slots.length < 620; attempt += 1) {
      const x = randBetween(rng, -widthM / 2, widthM / 2);
      const y = randBetween(rng, -heightM / 2, heightM / 2);
      const riverDistance = this.terrainModel.riverDistance(x, y);
      const inRiverBand = riverDistance > 42 && riverDistance < 160;
      const fieldClump = rng() < 0.045;

      if (inRiverBand || fieldClump) {
        slots.push({ x, y, scale: randBetween(rng, 0.7, 1.5) });
      }
    }

    const material = this.track(new THREE.MeshLambertMaterial({ color: 0x5c6640 }));
    const instanced = new THREE.InstancedMesh(tree, material, slots.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();
    // November palette: most trees bare-brown, some holding dull leaves.
    const autumn = [0x6b5a3a, 0x74603c, 0x5c6640, 0x7a6a45];

    slots.forEach((slot, index) => {
      matrix.compose(
        new THREE.Vector3(slot.x, this.terrainModel.elevation(slot.x, slot.y), slot.y),
        quaternion,
        new THREE.Vector3(slot.scale, slot.scale * randBetween(rng, 0.85, 1.2), slot.scale),
      );
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, color.setHex(autumn[Math.floor(rng() * autumn.length)]));
    });

    instanced.name = "trees";
    this.group.add(instanced);
  }

  private buildFort(point: WorldPoint) {
    // A simple bastioned trace for Fort Granger on its bluff.
    const wallSamples: Array<{ point: WorldPoint; heading: number }> = [];
    const spikes = 5;
    const outer = 95;
    const inner = 62;
    const ring: WorldPoint[] = [];

    for (let step = 0; step <= spikes * 2; step += 1) {
      const theta = (step / (spikes * 2)) * Math.PI * 2;
      const radius = step % 2 === 0 ? outer : inner;
      ring.push({
        x: point.x + Math.cos(theta) * radius,
        y: point.y + Math.sin(theta) * radius * 0.8,
      });
    }
    wallSamples.push(...samplePolyline(ring, 12));

    const wall = this.track(new THREE.BoxGeometry(13, 3.2, 4.4));
    const material = this.track(new THREE.MeshLambertMaterial({ color: 0x54462f }));
    const instanced = new THREE.InstancedMesh(wall, material, wallSamples.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);

    wallSamples.forEach((sample, index) => {
      quaternion.setFromAxisAngle(axisY, -sample.heading);
      matrix.compose(
        new THREE.Vector3(
          sample.point.x,
          this.terrainModel.elevation(sample.point.x, sample.point.y) + 1.5,
          sample.point.y,
        ),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      instanced.setMatrixAt(index, matrix);
    });

    instanced.name = "fort";
    this.group.add(instanced);
  }

  /** Drive sky, fog, sun, and lanterns from the battle clock. */
  updateLighting(timeMs: number) {
    const night = nightness(timeMs);
    const golden = goldenness(timeMs);

    // Sky: afternoon blue -> amber sunset -> near-black, moonless night.
    const day = new THREE.Color(0xb9c8d8);
    const dusk = new THREE.Color(0xd98d4f);
    const dark = new THREE.Color(0x070a14);
    this.skyColor.copy(day).lerp(dusk, Math.min(1, golden * 1.1));
    this.skyColor.lerp(dark, night);
    this.scene.background = this.skyColor;

    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(this.skyColor).lerp(new THREE.Color(0x777264), 0.35 * (1 - night));
      fog.density = 0.00016 + night * 0.00006;
    }

    // Sun sweeps toward the WSW horizon and dies.
    const hour = ((timeMs / 3_600_000 - 6) % 24 + 24) % 24;
    const sunProgress = Math.min(1, Math.max(0, (hour - 12) / 4.6));
    const elevation = THREE.MathUtils.lerp(0.9, 0.06, sunProgress);
    const azimuth = THREE.MathUtils.lerp(Math.PI * 0.05, Math.PI * 0.42, sunProgress);
    this.sun.position.set(
      -Math.sin(azimuth) * 3000,
      Math.max(120, Math.sin(elevation) * 3400),
      Math.cos(azimuth) * -1400 + 800,
    );
    this.sun.intensity = Math.max(0, 1.65 * (1 - night)) * (1 - golden * 0.25);
    this.sun.color.setHex(golden > 0.35 ? 0xffc078 : 0xfff2dc);

    // Keep a faint starlight floor so the night field stays readable.
    this.hemisphere.intensity = THREE.MathUtils.lerp(0.95, 0.34, night);
    this.hemisphere.color.setHex(night > 0.6 ? 0x39496e : 0xcfd8e8);

    for (const lantern of this.lanternLights) {
      lantern.intensity = night * 120;
    }
  }

  dispose() {
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables.length = 0;
  }
}
