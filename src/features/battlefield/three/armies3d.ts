import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createRng } from "@/features/battlefield/engine/rand";
import type { BatteryDef } from "@/features/battlefield/three/scene3d";
import { TerrainModel } from "@/features/battlefield/three/heightfield";
import {
  cavalryBlock,
  figureCount,
  infantryLine,
  offsetToWorld,
  type FigureOffset,
} from "@/features/battlefield/three/troopLayout";
import { casualtiesAtTime, interpolateFormationPositions } from "@/lib/battle/interpolation";
import type { Formation, ScenarioDataBundle } from "@/lib/battle/types";

const MEN_PER_FIGURE = 18;
const TROOPERS_PER_FIGURE = 24;
const MAX_FIGURES_PER_FORMATION = 320;
const FIGURE_SCALE = 2.05;

export interface FrontPoint {
  x: number;
  y: number;
  z: number;
  heading: number;
  frontage: number;
  side: "Union" | "Confederate";
}

interface FallenAnchor {
  timeMs: number;
  x: number;
  y: number;
  rotation: number;
}

interface FormationRuntime {
  formation: Formation;
  offsets: FigureOffset[];
  fallenAnchors: FallenAnchor[];
}

function soldierGeometry(): THREE.BufferGeometry {
  const legs = new THREE.BoxGeometry(0.42, 0.85, 0.5);
  legs.translate(0, 0.425, 0);
  const torso = new THREE.BoxGeometry(0.5, 0.66, 0.62);
  torso.translate(0, 1.18, 0);
  const head = new THREE.BoxGeometry(0.3, 0.32, 0.3);
  head.translate(0, 1.68, 0);
  const musket = new THREE.BoxGeometry(0.07, 1.45, 0.07);
  musket.translate(0.3, 1.15, 0.22);
  return mergeGeometries([legs, torso, head, musket]);
}

function horsemanGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(2.1, 0.72, 0.62);
  body.translate(0, 1.35, 0);
  const neck = new THREE.BoxGeometry(0.7, 0.7, 0.34);
  neck.translate(1.05, 1.8, 0);
  const head = new THREE.BoxGeometry(0.56, 0.3, 0.26);
  head.translate(1.45, 2.05, 0);
  const legFL = new THREE.BoxGeometry(0.18, 1.05, 0.18);
  legFL.translate(0.8, 0.5, 0.2);
  const legFR = legFL.clone();
  legFR.translate(0, 0, -0.4);
  const legBL = new THREE.BoxGeometry(0.18, 1.05, 0.18);
  legBL.translate(-0.8, 0.5, 0.2);
  const legBR = legBL.clone();
  legBR.translate(0, 0, -0.4);
  const rider = new THREE.BoxGeometry(0.46, 0.72, 0.5);
  rider.translate(-0.1, 2.1, 0);
  const riderHead = new THREE.BoxGeometry(0.26, 0.28, 0.26);
  riderHead.translate(-0.1, 2.6, 0);
  return mergeGeometries([body, neck, head, legFL, legFR, legBL, legBR, rider, riderHead]);
}

function cannonGeometry(): THREE.BufferGeometry {
  const barrel = new THREE.CylinderGeometry(0.17, 0.23, 2.6, 8);
  barrel.rotateZ(Math.PI / 2);
  barrel.rotateY(Math.PI);
  barrel.translate(0.4, 1.15, 0);
  const wheelLeft = new THREE.CylinderGeometry(0.78, 0.78, 0.14, 10);
  wheelLeft.rotateX(Math.PI / 2);
  wheelLeft.translate(0, 0.78, 0.75);
  const wheelRight = wheelLeft.clone();
  wheelRight.translate(0, 0, -1.5);
  const axle = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, 0.78, 0);
  const trail = new THREE.BoxGeometry(1.9, 0.2, 0.3);
  trail.translate(-1.15, 0.5, 0);
  return mergeGeometries([barrel, wheelLeft, wheelRight, axle, trail]);
}

function fallenGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1.75, 0.28, 0.55);
  body.translate(0, 0.14, 0);
  return body;
}

interface ArmyMeshSet {
  mesh: THREE.InstancedMesh;
  formationByInstance: string[];
  cursor: number;
}

/**
 * Instanced armies: infantry and cavalry figures laid out in ranks at their
 * interpolated positions, artillery at the batteries, and the fallen left
 * where the line stood when they dropped.
 */
export class Armies3D {
  readonly group = new THREE.Group();

  private runtimes = new Map<string, FormationRuntime>();
  private sets: Record<string, ArmyMeshSet>;
  private fallen: THREE.InstancedMesh;
  private cannons: THREE.InstancedMesh;
  private lastUpdateTime = Number.NaN;
  private disposables: Array<{ dispose(): void }> = [];
  private globalFinalCasualties: number;
  private frontPoints: FrontPoint[] = [];

  constructor(
    private bundle: ScenarioDataBundle,
    private terrain: TerrainModel,
    batteries: BatteryDef[],
  ) {
    const soldier = this.track(soldierGeometry());
    const horseman = this.track(horsemanGeometry());
    const cannon = this.track(cannonGeometry());
    const fallen = this.track(fallenGeometry());

    const unionMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const confMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const fallenMaterial = this.track(
      new THREE.MeshLambertMaterial({ color: 0x3d3628, transparent: true, opacity: 0.85 }),
    );
    const cannonMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x3a3f34 }));

    const capacity = (arm: "infantry" | "cavalry", side: "Union" | "Confederate") =>
      this.bundle.formations
        .filter((formation) => (formation.arm ?? "infantry") === arm && formation.side === side)
        .reduce(
          (sum, formation) =>
            sum
            + figureCount(
              formation.strengthEstimate,
              arm === "infantry" ? MEN_PER_FIGURE : TROOPERS_PER_FIGURE,
              MAX_FIGURES_PER_FORMATION,
            ),
          0,
        );

    const makeSet = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      count: number,
      baseColor: number,
      name: string,
    ): ArmyMeshSet => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false;

      const color = new THREE.Color();
      const base = new THREE.Color(baseColor);
      const rng = createRng(count * 977 + 5);
      for (let index = 0; index < Math.max(1, count); index += 1) {
        const shade = 0.82 + rng() * 0.32;
        color.copy(base).multiplyScalar(shade);
        mesh.setColorAt(index, color);
      }

      this.group.add(mesh);
      return { mesh, formationByInstance: [], cursor: 0 };
    };

    this.sets = {
      "infantry-Union": makeSet(soldier, unionMaterial, capacity("infantry", "Union"), 0x2c3e63, "infantry-union"),
      "infantry-Confederate": makeSet(soldier, confMaterial, capacity("infantry", "Confederate"), 0x6e5a41, "infantry-confederate"),
      "cavalry-Union": makeSet(horseman, unionMaterial, capacity("cavalry", "Union"), 0x2c3e63, "cavalry-union"),
      "cavalry-Confederate": makeSet(horseman, confMaterial, capacity("cavalry", "Confederate"), 0x6e5a41, "cavalry-confederate"),
    };

    const totalFallenCapacity = 900;
    this.fallen = new THREE.InstancedMesh(fallen, fallenMaterial, totalFallenCapacity);
    this.fallen.name = "fallen";
    this.fallen.count = 0;
    this.fallen.frustumCulled = false;
    this.group.add(this.fallen);

    // Artillery: guns spread just behind each battery point, facing the enemy.
    const gunSlots: Array<{ x: number; y: number; heading: number }> = [];
    for (const battery of batteries) {
      const facing = battery.side === "Union" ? Math.PI / 2 : -Math.PI / 2;
      for (let gun = 0; gun < battery.guns; gun += 1) {
        const spread = (gun - (battery.guns - 1) / 2) * 22;
        gunSlots.push({
          x: battery.point.x + Math.cos(facing + Math.PI / 2) * spread,
          y: battery.point.y + Math.sin(facing + Math.PI / 2) * spread,
          heading: facing,
        });
      }
    }

    this.cannons = new THREE.InstancedMesh(cannon, cannonMaterial, Math.max(1, gunSlots.length));
    this.cannons.name = "cannons";
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);
    gunSlots.forEach((slot, index) => {
      quaternion.setFromAxisAngle(axisY, -slot.heading);
      matrix.compose(
        new THREE.Vector3(slot.x, this.terrain.elevation(slot.x, slot.y), slot.y),
        quaternion,
        new THREE.Vector3(1.5, 1.5, 1.5),
      );
      this.cannons.setMatrixAt(index, matrix);
    });
    this.cannons.count = gunSlots.length;
    this.cannons.instanceMatrix.needsUpdate = true;
    this.group.add(this.cannons);
    this.gunSlots = gunSlots;

    this.globalFinalCasualties =
      bundle.casualtyTimeline[bundle.casualtyTimeline.length - 1]?.cumulativeCasualties ?? 1;

    for (const formation of bundle.formations) {
      this.runtimes.set(formation.id, {
        formation,
        offsets: [],
        fallenAnchors: this.computeFallenAnchors(formation),
      });
    }
  }

  gunSlots: Array<{ x: number; y: number; heading: number }> = [];

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  /**
   * Where and when each fallen figure dropped: times come from inverting the
   * cumulative casualty curve, positions from the formation's location at
   * that moment. Static per battle, so computed once.
   */
  private computeFallenAnchors(formation: Formation): FallenAnchor[] {
    const losses = formation.casualtyEstimate ?? 0;
    const figures = Math.floor(losses / MEN_PER_FIGURE / 2.4);
    if (figures <= 0) {
      return [];
    }

    const ticks = [...this.bundle.casualtyTimeline]
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (ticks.length < 2) {
      return [];
    }

    const final = ticks[ticks.length - 1].cumulativeCasualties;
    const anchors: FallenAnchor[] = [];

    for (let index = 0; index < figures; index += 1) {
      const target = ((index + 0.5) / figures) * final;
      let fallTime = Date.parse(ticks[ticks.length - 1].time);

      for (let seg = 0; seg < ticks.length - 1; seg += 1) {
        const a = ticks[seg];
        const b = ticks[seg + 1];
        if (target >= a.cumulativeCasualties && target <= b.cumulativeCasualties) {
          const span = Math.max(1, b.cumulativeCasualties - a.cumulativeCasualties);
          const blend = (target - a.cumulativeCasualties) / span;
          fallTime = Date.parse(a.time) + (Date.parse(b.time) - Date.parse(a.time)) * blend;
          break;
        }
      }

      const at = interpolateFormationPositions(fallTime, this.bundle.movementKeyframes)
        .find((entry) => entry.formationId === formation.id);
      if (!at) {
        continue;
      }

      const anchor = this.terrain.projection.toWorld(at.lat, at.lng);
      anchors.push({
        timeMs: fallTime,
        x: anchor.x + Math.sin(fallTime / 977 + anchor.x) * 34,
        y: anchor.y + Math.cos(fallTime / 613 + anchor.y) * 22,
        rotation: Math.sin(index * 7.3) * Math.PI,
      });
    }

    return anchors;
  }

  private headingOf(formationId: string, timeMs: number): number {
    const windowMs = 30 * 60 * 1000;
    const before = interpolateFormationPositions(timeMs - windowMs, this.bundle.movementKeyframes)
      .find((entry) => entry.formationId === formationId);
    const after = interpolateFormationPositions(timeMs + windowMs, this.bundle.movementKeyframes)
      .find((entry) => entry.formationId === formationId);

    if (before && after) {
      const a = this.terrain.projection.toWorld(before.lat, before.lng);
      const b = this.terrain.projection.toWorld(after.lat, after.lng);
      if (Math.hypot(b.x - a.x, b.y - a.y) > 2) {
        return Math.atan2(b.y - a.y, b.x - a.x);
      }
    }

    const formation = this.runtimes.get(formationId)?.formation;
    // Facing the opposing army: Union south (+y), Confederates north (-y).
    return formation?.side === "Union" ? Math.PI / 2 : -Math.PI / 2;
  }

  /** Which formation a raycast hit belongs to. */
  formationAt(mesh: THREE.Object3D, instanceId: number): string | null {
    for (const set of Object.values(this.sets)) {
      if (set.mesh === mesh) {
        return set.formationByInstance[instanceId] ?? null;
      }
    }
    return null;
  }

  get raycastTargets(): THREE.Object3D[] {
    return Object.values(this.sets).map((set) => set.mesh);
  }

  get fronts(): FrontPoint[] {
    return this.frontPoints;
  }

  /** Rebuild instance transforms for the given sim time (no-op if unchanged). */
  update(timeMs: number, force = false) {
    if (!force && timeMs === this.lastUpdateTime) {
      return;
    }
    this.lastUpdateTime = timeMs;

    const positions = interpolateFormationPositions(timeMs, this.bundle.movementKeyframes);
    const globalNow = casualtiesAtTime(this.bundle.casualtyTimeline, timeMs).value;
    const casualtyRatio = globalNow / Math.max(1, this.globalFinalCasualties);

    for (const set of Object.values(this.sets)) {
      set.cursor = 0;
      set.formationByInstance.length = 0;
    }
    this.frontPoints.length = 0;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE);
    let fallenCursor = 0;

    for (const position of positions) {
      const runtime = this.runtimes.get(position.formationId);
      if (!runtime) {
        continue;
      }

      const formation = runtime.formation;
      const arm = formation.arm ?? "infantry";
      const setKey = `${arm}-${formation.side}`;
      const set = this.sets[setKey];
      if (!set) {
        continue;
      }

      const losses = (formation.casualtyEstimate ?? 0) * casualtyRatio;
      const remaining = Math.max(0.2, 1 - losses / Math.max(1, formation.strengthEstimate));
      const perFigure = arm === "infantry" ? MEN_PER_FIGURE : TROOPERS_PER_FIGURE;
      const fullCount = figureCount(formation.strengthEstimate, perFigure, MAX_FIGURES_PER_FORMATION);
      const count = Math.max(3, Math.round(fullCount * remaining));

      if (runtime.offsets.length !== fullCount) {
        runtime.offsets = arm === "infantry" ? infantryLine(fullCount) : cavalryBlock(fullCount);
      }

      const center = this.terrain.projection.toWorld(position.lat, position.lng);
      const heading = this.headingOf(formation.id, timeMs);
      quaternion.setFromAxisAngle(axisY, -heading);

      for (let index = 0; index < count && set.cursor < set.mesh.instanceMatrix.count; index += 1) {
        const world = offsetToWorld(center.x, center.y, heading, runtime.offsets[index]);
        const ground = this.terrain.elevation(world.x, world.y);
        matrix.compose(new THREE.Vector3(world.x, ground, world.y), quaternion, scale);
        set.mesh.setMatrixAt(set.cursor, matrix);
        set.formationByInstance[set.cursor] = formation.id;
        set.cursor += 1;
      }

      const frontage = Math.min(
        520,
        (Math.ceil(fullCount / (arm === "infantry" ? 2 : 3)) - 1) * (arm === "infantry" ? 4.2 : 7.5),
      );

      if (position.engaged) {
        const frontX = center.x + Math.cos(heading) * 14;
        const frontY = center.y + Math.sin(heading) * 14;
        this.frontPoints.push({
          x: frontX,
          y: this.terrain.elevation(frontX, frontY) + 1.6,
          z: frontY,
          heading,
          frontage: frontage * remaining,
          side: formation.side,
        });
      }

      // The fallen: fixed where the line stood at the moment each dropped.
      const fallenQuaternion = new THREE.Quaternion();
      for (const anchor of runtime.fallenAnchors) {
        if (anchor.timeMs > timeMs || fallenCursor >= this.fallen.instanceMatrix.count) {
          continue;
        }

        fallenQuaternion.setFromAxisAngle(axisY, anchor.rotation);
        matrix.compose(
          new THREE.Vector3(
            anchor.x,
            this.terrain.elevation(anchor.x, anchor.y) + 0.1,
            anchor.y,
          ),
          fallenQuaternion,
          scale,
        );
        this.fallen.setMatrixAt(fallenCursor, matrix);
        fallenCursor += 1;
      }
    }

    for (const set of Object.values(this.sets)) {
      set.mesh.count = set.cursor;
      set.mesh.instanceMatrix.needsUpdate = true;
    }
    this.fallen.count = fallenCursor;
    this.fallen.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables.length = 0;
  }
}
