import type { CameraController, Viewport } from "@/features/battlefield/engine/camera";
import type { BattleParticles } from "@/features/battlefield/engine/particles";
import { createProjection, type Projection, type WorldPoint } from "@/features/battlefield/engine/projection";
import { createRng, randBetween } from "@/features/battlefield/engine/rand";
import { interpolateFormationPositions } from "@/lib/battle/interpolation";
import { goldenness, nightness } from "@/lib/battle/time";
import type {
  ConfidenceLevel,
  Formation,
  ScenarioDataBundle,
} from "@/lib/battle/types";

export interface FrameState {
  timeMs: number;
  dtMs: number;
  selectedFormationId: string | null;
  hoveredFormationId: string | null;
  focusWorld: WorldPoint | null;
  isPlaying: boolean;
  reducedMotion: boolean;
  effectsBudget: number;
}

export interface FormationScreenAnchor {
  formationId: string;
  x: number;
  y: number;
  radiusPx: number;
}

interface TrackPoint {
  t: number;
  x: number;
  y: number;
  confidence: ConfidenceLevel;
  engaged: boolean;
}

interface PathFeature {
  name: string;
  styleKey: string;
  points: WorldPoint[];
  confidence: ConfidenceLevel;
}

interface PolygonFeature {
  name: string;
  styleKey: string;
  rings: WorldPoint[][];
}

interface PointFeature {
  name: string;
  styleKey: string;
  point: WorldPoint;
  radiusM: number;
}

interface LabelFeature {
  name: string;
  point: WorldPoint;
  importance: number;
  type: string;
}

const COLORS = {
  ink: "#4a3823",
  inkSoft: "rgba(74, 56, 35, 0.55)",
  water: "#8aa3b4",
  waterDeep: "#7593a7",
  road: "#d9c194",
  roadCasing: "rgba(61, 46, 29, 0.5)",
  union: "#3a659c",
  unionEdge: "#20395e",
  confederate: "#a24533",
  confederateEdge: "#5f2418",
  gold: "#d8ad62",
  works: "#44607e",
};

function shortName(name: string): string {
  return name.split("'")[0].toUpperCase();
}

function smoothPath(ctx: CanvasRenderingContext2D, points: WorldPoint[]) {
  if (points.length < 2) {
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length - 1; index += 1) {
    const midX = (points[index].x + points[index + 1].x) / 2;
    const midY = (points[index].y + points[index + 1].y) / 2;
    ctx.quadraticCurveTo(points[index].x, points[index].y, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function polyline(ctx: CanvasRenderingContext2D, points: WorldPoint[]) {
  if (points.length < 2) {
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
}

export class BattlefieldScene {
  readonly projection: Projection;

  private bundle: ScenarioDataBundle;
  private formationById = new Map<string, Formation>();
  private tracks = new Map<string, TrackPoint[]>();
  private rivers: PathFeature[] = [];
  private roads: PathFeature[] = [];
  private railroads: PathFeature[] = [];
  private works: PathFeature[] = [];
  private polygons: PolygonFeature[] = [];
  private hills: PointFeature[] = [];
  private landmarks: PointFeature[] = [];
  private labels: LabelFeature[] = [];
  private stipples: WorldPoint[] = [];
  private treeClumps: Array<{ x: number; y: number; r: number }> = [];
  private casualtySegments: Array<{ t0: number; t1: number; v0: number; v1: number }> = [];
  private maxCasualtyRate = 1;
  private grainCanvas: HTMLCanvasElement | null = null;
  private fontFamily: string;
  private effectClock = 0;

  constructor(bundle: ScenarioDataBundle, fontFamily = "Georgia, serif") {
    this.bundle = bundle;
    this.fontFamily = fontFamily;
    this.projection = createProjection(bundle.manifest.bounds);

    for (const formation of bundle.formations) {
      this.formationById.set(formation.id, formation);
    }

    this.buildTracks();
    this.buildLayers();
    this.buildLabels();
    this.buildFieldTexture();
    this.buildCasualtyCurve();
  }

  private buildTracks() {
    const ordered = [...this.bundle.movementKeyframes]
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    for (const keyframe of ordered) {
      const t = Date.parse(keyframe.timestamp);
      for (const position of keyframe.positions) {
        const world = this.projection.toWorld(position.lat, position.lng);
        const track = this.tracks.get(position.formationId) ?? [];
        track.push({
          t,
          x: world.x,
          y: world.y,
          confidence: keyframe.confidence,
          engaged: Boolean(position.engaged),
        });
        this.tracks.set(position.formationId, track);
      }
    }
  }

  private buildLayers() {
    for (const feature of this.bundle.mapLayerPack.features) {
      const props = feature.properties;

      if (feature.geometry.type === "LineString") {
        const points = feature.geometry.coordinates.map(([lng, lat]) =>
          this.projection.toWorld(lat, lng),
        );
        const path: PathFeature = {
          name: props.name,
          styleKey: props.styleKey,
          points,
          confidence: props.confidence,
        };

        if (props.category === "river") {
          this.rivers.push(path);
        } else if (props.styleKey === "railroad") {
          this.railroads.push(path);
        } else if (props.category === "works") {
          this.works.push(path);
        } else {
          this.roads.push(path);
        }
        continue;
      }

      if (feature.geometry.type === "Polygon") {
        this.polygons.push({
          name: props.name,
          styleKey: props.styleKey,
          rings: feature.geometry.coordinates.map((ring) =>
            ring.map(([lng, lat]) => this.projection.toWorld(lat, lng)),
          ),
        });
        continue;
      }

      if (feature.geometry.type === "Point") {
        const [lng, lat] = feature.geometry.coordinates;
        const rawRadius = (props as unknown as { radiusM?: unknown }).radiusM;
        const radiusM = typeof rawRadius === "number" ? rawRadius : 120;
        const entry: PointFeature = {
          name: props.name,
          styleKey: props.styleKey,
          point: this.projection.toWorld(lat, lng),
          radiusM,
        };

        if (props.styleKey === "hill") {
          this.hills.push(entry);
        } else {
          this.landmarks.push(entry);
        }
      }
    }
  }

  private buildLabels() {
    for (const label of this.bundle.mapLabels) {
      this.labels.push({
        name: label.name,
        point: this.projection.toWorld(label.lat, label.lng),
        importance: label.importance,
        type: label.type,
      });
    }
  }

  private buildFieldTexture() {
    const rng = createRng(0x1864);
    const { widthM, heightM } = this.projection;

    for (let clump = 0; clump < 34; clump += 1) {
      const cx = randBetween(rng, -widthM / 2, widthM / 2);
      const cy = randBetween(rng, -heightM / 2, heightM / 2);
      const count = 14 + Math.floor(rng() * 16);

      for (let index = 0; index < count; index += 1) {
        this.stipples.push({
          x: cx + randBetween(rng, -260, 260),
          y: cy + randBetween(rng, -170, 170),
        });
      }
    }

    for (const river of this.rivers) {
      for (let index = 0; index < river.points.length; index += 2) {
        const anchor = river.points[index];
        if (rng() > 0.45) {
          continue;
        }
        const count = 4 + Math.floor(rng() * 5);
        for (let tree = 0; tree < count; tree += 1) {
          this.treeClumps.push({
            x: anchor.x + randBetween(rng, -220, 220),
            y: anchor.y + randBetween(rng, -150, 150),
            r: randBetween(rng, 18, 44),
          });
        }
      }
    }
  }

  private buildCasualtyCurve() {
    const ticks = [...this.bundle.casualtyTimeline]
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

    for (let index = 0; index < ticks.length - 1; index += 1) {
      const t0 = Date.parse(ticks[index].time);
      const t1 = Date.parse(ticks[index + 1].time);
      const segment = {
        t0,
        t1,
        v0: ticks[index].cumulativeCasualties,
        v1: ticks[index + 1].cumulativeCasualties,
      };
      this.casualtySegments.push(segment);
      const rate = (segment.v1 - segment.v0) / Math.max(1, t1 - t0);
      this.maxCasualtyRate = Math.max(this.maxCasualtyRate, rate);
    }
  }

  casualtiesAt(timeMs: number): number {
    if (this.casualtySegments.length === 0) {
      return 0;
    }

    const first = this.casualtySegments[0];
    if (timeMs <= first.t0) {
      return first.v0;
    }

    for (const segment of this.casualtySegments) {
      if (timeMs >= segment.t0 && timeMs <= segment.t1) {
        const blend = (timeMs - segment.t0) / Math.max(1, segment.t1 - segment.t0);
        return Math.round(segment.v0 + (segment.v1 - segment.v0) * blend);
      }
    }

    return this.casualtySegments[this.casualtySegments.length - 1].v1;
  }

  /** Normalized 0..1 intensity of the fighting at a moment. */
  intensityAt(timeMs: number): number {
    for (const segment of this.casualtySegments) {
      if (timeMs >= segment.t0 && timeMs <= segment.t1) {
        const rate = (segment.v1 - segment.v0) / Math.max(1, segment.t1 - segment.t0);
        return Math.min(1, rate / this.maxCasualtyRate);
      }
    }
    return 0;
  }

  headingAt(formationId: string, timeMs: number): number {
    const track = this.tracks.get(formationId);
    if (!track || track.length < 2) {
      return 0;
    }

    const windowMs = 30 * 60 * 1000;
    const before = this.pointOnTrack(track, timeMs - windowMs);
    const after = this.pointOnTrack(track, timeMs + windowMs);
    const dx = after.x - before.x;
    const dy = after.y - before.y;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      // Stationary: face the opposing army (Union faces south, Confederates north).
      const formation = this.formationById.get(formationId);
      return formation?.side === "Union" ? Math.PI / 2 : -Math.PI / 2;
    }

    return Math.atan2(dy, dx);
  }

  /** Interpolated world position of a formation, for camera follow. */
  formationWorldAt(formationId: string, timeMs: number): WorldPoint | null {
    const track = this.tracks.get(formationId);
    if (!track || track.length === 0) {
      return null;
    }

    return this.pointOnTrack(track, timeMs);
  }

  private pointOnTrack(track: TrackPoint[], timeMs: number): WorldPoint {
    if (timeMs <= track[0].t) {
      return track[0];
    }

    for (let index = 0; index < track.length - 1; index += 1) {
      const left = track[index];
      const right = track[index + 1];
      if (timeMs >= left.t && timeMs <= right.t) {
        const blend = (timeMs - left.t) / Math.max(1, right.t - left.t);
        return {
          x: left.x + (right.x - left.x) * blend,
          y: left.y + (right.y - left.y) * blend,
        };
      }
    }

    return track[track.length - 1];
  }

  setFontFamily(fontFamily: string) {
    this.fontFamily = fontFamily;
  }

  /**
   * Paint one frame. Returns screen anchors of every formation for hit-testing.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: CameraController,
    viewport: Viewport,
    particles: BattleParticles,
    frame: FrameState,
    devicePixelRatio = 1,
  ): FormationScreenAnchor[] {
    const night = nightness(frame.timeMs);
    const golden = goldenness(frame.timeMs);
    const scale = camera.current.scale;

    this.effectClock += frame.dtMs;

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.paintParchment(ctx, viewport);

    ctx.save();
    ctx.translate(viewport.width / 2, viewport.height / 2);
    ctx.scale(scale, scale);
    ctx.rotate(camera.current.bearing);
    ctx.translate(-camera.current.x, -camera.current.y);

    this.paintNeatline(ctx, scale);
    this.paintSectors(ctx);
    this.paintFieldTexture(ctx, scale);
    this.paintHills(ctx, scale);
    this.paintRivers(ctx, scale);
    this.paintRoads(ctx, scale);
    this.paintRailroads(ctx, scale);
    this.paintWorks(ctx, scale);
    this.paintLandmarks(ctx, scale);
    this.paintTrails(ctx, scale, frame.timeMs);

    const anchors = this.paintFormations(ctx, camera, viewport, particles, frame, scale);

    if (frame.focusWorld) {
      this.paintFocusRing(ctx, frame.focusWorld, scale, frame.reducedMotion);
    }

    ctx.restore();

    particles.drawSmoke(ctx, camera, viewport, night);
    particles.drawFlashes(ctx, camera, viewport, night);

    this.paintLighting(ctx, camera, viewport, frame, night, golden);
    this.paintGrain(ctx, viewport);
    this.paintLabels(ctx, camera, viewport, night, scale);
    this.paintFormationLabels(ctx, camera, viewport, frame, anchors, night);
    this.paintCompassAndScale(ctx, camera, viewport, night);

    return anchors;
  }

  private paintParchment(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    const gradient = ctx.createLinearGradient(0, 0, viewport.width, viewport.height);
    gradient.addColorStop(0, "#efe4c8");
    gradient.addColorStop(0.5, "#e9dbb9");
    gradient.addColorStop(1, "#dfcda5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const glow = ctx.createRadialGradient(
      viewport.width * 0.5,
      viewport.height * 0.42,
      Math.min(viewport.width, viewport.height) * 0.2,
      viewport.width * 0.5,
      viewport.height * 0.5,
      Math.max(viewport.width, viewport.height) * 0.75,
    );
    glow.addColorStop(0, "rgba(255, 248, 226, 0.32)");
    glow.addColorStop(1, "rgba(120, 92, 54, 0.16)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }

  private paintNeatline(ctx: CanvasRenderingContext2D, scale: number) {
    const { widthM, heightM } = this.projection;
    const left = -widthM / 2;
    const top = -heightM / 2;

    ctx.strokeStyle = "rgba(74, 56, 35, 0.16)";
    ctx.lineWidth = 1 / scale;

    const stepM = 0.01 * 110_540;
    ctx.beginPath();
    for (let x = left + stepM; x < widthM / 2; x += stepM) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, heightM / 2);
    }
    for (let y = top + stepM; y < heightM / 2; y += stepM) {
      ctx.moveTo(left, y);
      ctx.lineTo(widthM / 2, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(74, 56, 35, 0.4)";
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(left, top, widthM, heightM);
    ctx.strokeStyle = "rgba(74, 56, 35, 0.24)";
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(left - 8 / scale, top - 8 / scale, widthM + 16 / scale, heightM + 16 / scale);
  }

  private paintSectors(ctx: CanvasRenderingContext2D) {
    for (const polygon of this.polygons) {
      ctx.beginPath();
      for (const ring of polygon.rings) {
        polyline(ctx, ring);
        ctx.closePath();
      }

      if (polygon.styleKey === "town-core") {
        ctx.fillStyle = "rgba(140, 112, 82, 0.18)";
        ctx.fill();
        this.paintTownBlocks(ctx, polygon);
        continue;
      }

      ctx.fillStyle = polygon.styleKey === "sector-contested"
        ? "rgba(158, 88, 60, 0.10)"
        : "rgba(120, 100, 70, 0.10)";
      ctx.fill();
    }
  }

  private paintTownBlocks(ctx: CanvasRenderingContext2D, polygon: PolygonFeature) {
    const ring = polygon.rings[0];
    if (!ring || ring.length === 0) {
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of ring) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    const rng = createRng(0x70b1);
    ctx.fillStyle = "rgba(96, 74, 52, 0.42)";
    const blockW = 68;
    const blockH = 52;
    const gap = 42;

    for (let y = minY + gap; y < maxY - blockH; y += blockH + gap) {
      for (let x = minX + gap; x < maxX - blockW; x += blockW + gap) {
        if (rng() < 0.22) {
          continue;
        }
        ctx.fillRect(
          x + randBetween(rng, -6, 6),
          y + randBetween(rng, -5, 5),
          blockW * randBetween(rng, 0.55, 1),
          blockH * randBetween(rng, 0.55, 1),
        );
      }
    }
  }

  private paintFieldTexture(ctx: CanvasRenderingContext2D, scale: number) {
    if (scale < 0.09) {
      return;
    }

    ctx.fillStyle = "rgba(112, 92, 56, 0.16)";
    const size = 2.6;
    for (const stipple of this.stipples) {
      ctx.fillRect(stipple.x, stipple.y, size, size);
    }

    ctx.fillStyle = "rgba(84, 92, 52, 0.2)";
    for (const tree of this.treeClumps) {
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private paintHills(ctx: CanvasRenderingContext2D, scale: number) {
    for (const hill of this.hills) {
      const rng = createRng(Math.round(hill.point.x * 7 + hill.point.y * 13));
      const rings = [1, 0.68, 0.4];

      ctx.strokeStyle = "rgba(96, 74, 44, 0.34)";
      ctx.lineWidth = 1.4 / scale;

      for (const ringScale of rings) {
        const radius = hill.radiusM * ringScale;
        ctx.beginPath();
        const wobblePhase = rng() * Math.PI * 2;
        for (let step = 0; step <= 26; step += 1) {
          const theta = (step / 26) * Math.PI * 2;
          const wobble = 1 + 0.08 * Math.sin(theta * 3 + wobblePhase) + 0.05 * Math.sin(theta * 7);
          const px = hill.point.x + Math.cos(theta) * radius * wobble;
          const py = hill.point.y + Math.sin(theta) * radius * wobble * 0.82;
          if (step === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(96, 74, 44, 0.22)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      const ticks = 44;
      for (let tick = 0; tick < ticks; tick += 1) {
        const theta = (tick / ticks) * Math.PI * 2 + rng() * 0.05;
        const inner = hill.radiusM * 0.98;
        const outer = hill.radiusM * (0.78 - rng() * 0.1);
        ctx.moveTo(
          hill.point.x + Math.cos(theta) * inner,
          hill.point.y + Math.sin(theta) * inner * 0.82,
        );
        ctx.lineTo(
          hill.point.x + Math.cos(theta) * outer,
          hill.point.y + Math.sin(theta) * outer * 0.82,
        );
      }
      ctx.stroke();
    }
  }

  private paintRivers(ctx: CanvasRenderingContext2D, scale: number) {
    for (const river of this.rivers) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = "rgba(101, 128, 148, 0.5)";
      ctx.lineWidth = 56;
      ctx.beginPath();
      smoothPath(ctx, river.points);
      ctx.stroke();

      ctx.strokeStyle = COLORS.water;
      ctx.lineWidth = 40;
      ctx.beginPath();
      smoothPath(ctx, river.points);
      ctx.stroke();

      ctx.strokeStyle = "rgba(210, 224, 230, 0.5)";
      ctx.lineWidth = 12;
      ctx.beginPath();
      smoothPath(ctx, river.points);
      ctx.stroke();

      ctx.strokeStyle = "rgba(70, 96, 118, 0.65)";
      ctx.lineWidth = 2.4 / Math.max(scale, 0.08);
      ctx.setLineDash([46, 34]);
      ctx.beginPath();
      smoothPath(ctx, river.points);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private paintRoads(ctx: CanvasRenderingContext2D, scale: number) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const road of this.roads) {
      const primary = road.styleKey === "road-primary";

      ctx.strokeStyle = COLORS.roadCasing;
      ctx.lineWidth = primary ? 13 : 9;
      ctx.beginPath();
      smoothPath(ctx, road.points);
      ctx.stroke();

      ctx.strokeStyle = COLORS.road;
      ctx.lineWidth = primary ? 8 : 5;
      if (road.confidence === "inferred") {
        ctx.setLineDash([60, 26]);
      }
      ctx.beginPath();
      smoothPath(ctx, road.points);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    void scale;
  }

  private paintRailroads(ctx: CanvasRenderingContext2D, scale: number) {
    for (const rail of this.railroads) {
      ctx.strokeStyle = "rgba(58, 46, 32, 0.72)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      polyline(ctx, rail.points);
      ctx.stroke();

      ctx.lineWidth = 2.2 / Math.max(scale, 0.1);
      ctx.beginPath();
      for (let index = 0; index < rail.points.length - 1; index += 1) {
        const a = rail.points[index];
        const b = rail.points[index + 1];
        const segLength = Math.hypot(b.x - a.x, b.y - a.y);
        const ticks = Math.floor(segLength / 60);
        const nx = -(b.y - a.y) / segLength;
        const ny = (b.x - a.x) / segLength;

        for (let tick = 0; tick <= ticks; tick += 1) {
          const blend = tick / Math.max(1, ticks);
          const px = a.x + (b.x - a.x) * blend;
          const py = a.y + (b.y - a.y) * blend;
          ctx.moveTo(px + nx * 14, py + ny * 14);
          ctx.lineTo(px - nx * 14, py - ny * 14);
        }
      }
      ctx.stroke();
    }
  }

  private paintWorks(ctx: CanvasRenderingContext2D, scale: number) {
    for (const work of this.works) {
      ctx.strokeStyle = COLORS.works;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      if (work.confidence === "inferred") {
        ctx.setLineDash([52, 30]);
      }
      ctx.beginPath();
      smoothPath(ctx, work.points);
      ctx.stroke();
      ctx.setLineDash([]);

      // Sawtooth entrenchment ticks on the enemy-facing (south) side.
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      for (let index = 0; index < work.points.length - 1; index += 1) {
        const a = work.points[index];
        const b = work.points[index + 1];
        const segLength = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLength < 1) {
          continue;
        }
        let nx = -(b.y - a.y) / segLength;
        let ny = (b.x - a.x) / segLength;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
        }

        const ticks = Math.floor(segLength / 46);
        for (let tick = 0; tick <= ticks; tick += 1) {
          const blend = tick / Math.max(1, ticks);
          const px = a.x + (b.x - a.x) * blend;
          const py = a.y + (b.y - a.y) * blend;
          ctx.moveTo(px, py);
          ctx.lineTo(px + nx * 22, py + ny * 22);
        }
      }
      ctx.stroke();
    }
    void scale;
  }

  private paintLandmarks(ctx: CanvasRenderingContext2D, scale: number) {
    for (const landmark of this.landmarks) {
      const size = 26;
      ctx.save();
      ctx.translate(landmark.point.x, landmark.point.y);

      if (landmark.styleKey === "fort") {
        ctx.strokeStyle = "rgba(58, 62, 78, 0.85)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let point = 0; point < 4; point += 1) {
          const theta = (point / 4) * Math.PI * 2 + Math.PI / 4;
          const px = Math.cos(theta) * size * 1.6;
          const py = Math.sin(theta) * size * 1.6;
          if (point === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = "rgba(58, 62, 78, 0.3)";
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(70, 52, 32, 0.9)";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.strokeStyle = "rgba(238, 226, 198, 0.8)";
        ctx.lineWidth = 2.4;
        ctx.strokeRect(-size / 2, -size / 2, size, size);
      }

      ctx.restore();
    }
    void scale;
  }

  private paintTrails(ctx: CanvasRenderingContext2D, scale: number, timeMs: number) {
    ctx.lineCap = "round";

    for (const [formationId, track] of this.tracks) {
      const formation = this.formationById.get(formationId);
      if (!formation || track.length < 2 || timeMs <= track[0].t) {
        continue;
      }

      const color = formation.side === "Union" ? COLORS.union : COLORS.confederate;
      const tip = this.pointOnTrack(track, timeMs);

      for (let index = 0; index < track.length - 1; index += 1) {
        const a = track[index];
        const b = track[index + 1];
        if (a.t >= timeMs) {
          break;
        }

        const end = b.t <= timeMs ? b : tip;
        const inferred = b.confidence === "inferred" || a.confidence === "inferred";

        ctx.strokeStyle = color;
        ctx.globalAlpha = inferred ? 0.26 : 0.44;
        ctx.lineWidth = 7;
        if (inferred) {
          ctx.setLineDash([34, 26]);
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (b.t > timeMs) {
          break;
        }
      }
    }

    ctx.globalAlpha = 1;
    void scale;
  }

  private paintFormations(
    ctx: CanvasRenderingContext2D,
    camera: CameraController,
    viewport: Viewport,
    particles: BattleParticles,
    frame: FrameState,
    scale: number,
  ): FormationScreenAnchor[] {
    const positions = interpolateFormationPositions(frame.timeMs, this.bundle.movementKeyframes);
    const anchors: FormationScreenAnchor[] = [];
    const intensity = this.intensityAt(frame.timeMs);
    const casualtyRatio = this.casualtiesAt(frame.timeMs)
      / Math.max(1, this.casualtySegments.at(-1)?.v1 ?? 1);
    const spawnEffects = frame.isPlaying || this.effectClock < 4000;

    for (const position of positions) {
      const formation = this.formationById.get(position.formationId);
      if (!formation) {
        continue;
      }

      const world = this.projection.toWorld(position.lat, position.lng);
      const heading = this.headingAt(formation.id, frame.timeMs);
      const isSelected = frame.selectedFormationId === formation.id;
      const isHovered = frame.hoveredFormationId === formation.id;

      const losses = (formation.casualtyEstimate ?? 0) * casualtyRatio;
      const remaining = Math.max(0.25, 1 - losses / Math.max(1, formation.strengthEstimate));

      const widthM = (170 + formation.strengthEstimate / 32) * (0.6 + 0.4 * remaining);
      const depthM = 62;

      const union = formation.side === "Union";
      const fill = union ? COLORS.union : COLORS.confederate;
      const edge = union ? COLORS.unionEdge : COLORS.confederateEdge;
      const documented = position.confidence === "documented";

      if (!documented && position.uncertaintyMeters) {
        ctx.fillStyle = union ? "rgba(58, 101, 156, 0.10)" : "rgba(162, 69, 51, 0.10)";
        ctx.beginPath();
        ctx.arc(world.x, world.y, position.uncertaintyMeters, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(world.x, world.y);
      // Blocks face their heading: rotate so the long edge is the front.
      ctx.rotate(heading + Math.PI / 2);

      if (!frame.reducedMotion && position.engaged) {
        const jitter = Math.sin(this.effectClock / 60 + world.x) * 3;
        ctx.translate(jitter * 0.4, 0);
      }

      ctx.globalAlpha = documented ? 0.94 : 0.62;
      ctx.fillStyle = fill;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.rect(-widthM / 2, -depthM / 2, widthM, depthM);
      ctx.fill();
      ctx.stroke();

      // Rank lines suggest lines of battle.
      ctx.strokeStyle = "rgba(244, 236, 214, 0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-widthM / 2 + 10, -depthM / 6);
      ctx.lineTo(widthM / 2 - 10, -depthM / 6);
      ctx.moveTo(-widthM / 2 + 10, depthM / 6);
      ctx.lineTo(widthM / 2 - 10, depthM / 6);
      ctx.stroke();

      if (position.engaged) {
        ctx.strokeStyle = "rgba(255, 196, 110, 0.85)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-widthM / 2, -depthM / 2 - 6);
        ctx.lineTo(widthM / 2, -depthM / 2 - 6);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? COLORS.gold : "rgba(238, 220, 180, 0.8)";
        ctx.lineWidth = isSelected ? 7 : 5;
        ctx.setLineDash(isSelected ? [] : [18, 14]);
        ctx.strokeRect(-widthM / 2 - 22, -depthM / 2 - 22, widthM + 44, depthM + 44);
        ctx.setLineDash([]);
      }

      ctx.restore();

      // Engagement effects spawn from the front edge (toward the enemy).
      if (position.engaged && !frame.reducedMotion && spawnEffects) {
        const frontX = world.x + Math.cos(heading) * (depthM / 2 + 18);
        const frontY = world.y + Math.sin(heading) * (depthM / 2 + 18);
        const budget = frame.effectsBudget;

        if (Math.random() < (0.16 + intensity * 0.5) * budget) {
          particles.spawnFlash(frontX, frontY, widthM * 0.9);
        }
        if (Math.random() < (0.05 + intensity * 0.16) * budget) {
          particles.spawnSmoke(frontX, frontY, 0.5 + intensity);
        }
      }

      const screen = camera.worldToScreen(world, viewport);
      anchors.push({
        formationId: formation.id,
        x: screen.x,
        y: screen.y,
        radiusPx: Math.max(20, (widthM / 2) * scale),
      });
    }

    return anchors;
  }

  private paintFocusRing(
    ctx: CanvasRenderingContext2D,
    focus: WorldPoint,
    scale: number,
    reducedMotion: boolean,
  ) {
    const pulse = reducedMotion ? 0 : Math.sin(this.effectClock / 340);
    ctx.strokeStyle = `rgba(216, 173, 98, ${0.75 + pulse * 0.2})`;
    ctx.lineWidth = 2.6 / scale;
    ctx.beginPath();
    ctx.arc(focus.x, focus.y, 110 + pulse * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(216, 173, 98, 0.4)";
    ctx.lineWidth = 1.4 / scale;
    ctx.beginPath();
    ctx.arc(focus.x, focus.y, 150 + pulse * 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  private paintLighting(
    ctx: CanvasRenderingContext2D,
    camera: CameraController,
    viewport: Viewport,
    frame: FrameState,
    night: number,
    golden: number,
  ) {
    if (golden > 0.02) {
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = `rgba(255, 148, 54, ${0.5 * golden})`;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      ctx.globalCompositeOperation = "source-over";
    }

    if (night > 0.01) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgba(47, 53, 86, ${Math.min(0.86, night * 0.86)})`;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      ctx.globalCompositeOperation = "source-over";

      // Warm ground light where the fighting is: the field lit by gunfire.
      const positions = interpolateFormationPositions(frame.timeMs, this.bundle.movementKeyframes);
      ctx.globalCompositeOperation = "screen";
      for (const position of positions) {
        if (!position.engaged) {
          continue;
        }
        const world = this.projection.toWorld(position.lat, position.lng);
        const screen = camera.worldToScreen(world, viewport);
        const radius = 170 * camera.current.scale;
        const flicker = frame.reducedMotion
          ? 1
          : 0.86 + 0.14 * Math.sin(this.effectClock / 90 + world.x * 0.01);
        const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
        gradient.addColorStop(0, `rgba(255, 158, 66, ${0.2 * night * flicker})`);
        gradient.addColorStop(1, "rgba(255, 158, 66, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(screen.x - radius, screen.y - radius, radius * 2, radius * 2);
      }
      ctx.globalCompositeOperation = "source-over";

      const vignette = ctx.createRadialGradient(
        viewport.width / 2,
        viewport.height / 2,
        Math.min(viewport.width, viewport.height) * 0.3,
        viewport.width / 2,
        viewport.height / 2,
        Math.max(viewport.width, viewport.height) * 0.72,
      );
      vignette.addColorStop(0, "rgba(4, 6, 14, 0)");
      vignette.addColorStop(1, `rgba(4, 6, 14, ${0.34 * night})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
  }

  private paintGrain(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    if (!this.grainCanvas && typeof document !== "undefined") {
      const grain = document.createElement("canvas");
      grain.width = 220;
      grain.height = 220;
      const grainCtx = grain.getContext("2d");
      if (grainCtx) {
        const rng = createRng(0x9e37);
        for (let index = 0; index < 620; index += 1) {
          grainCtx.fillStyle = `rgba(84, 62, 38, ${randBetween(rng, 0.02, 0.09)})`;
          grainCtx.fillRect(rng() * 220, rng() * 220, randBetween(rng, 0.6, 2.4), randBetween(rng, 0.6, 2));
        }
        this.grainCanvas = grain;
      }
    }

    if (this.grainCanvas) {
      const pattern = ctx.createPattern(this.grainCanvas, "repeat");
      if (pattern) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
        ctx.globalAlpha = 1;
      }
    }
  }

  private paintLabels(
    ctx: CanvasRenderingContext2D,
    camera: CameraController,
    viewport: Viewport,
    night: number,
    scale: number,
  ) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const ink = this.mixLabelColor(night);
    const halo = night > 0.5 ? "rgba(10, 12, 22, 0.75)" : "rgba(238, 226, 198, 0.85)";

    for (const label of this.labels) {
      const minScale = label.importance >= 5 ? 0 : label.importance >= 4 ? 0.1 : 0.17;
      if (scale < minScale) {
        continue;
      }

      const screen = camera.worldToScreen(label.point, viewport);
      if (screen.x < -80 || screen.y < -40
        || screen.x > viewport.width + 80 || screen.y > viewport.height + 40) {
        continue;
      }

      const sizePx = Math.min(17, 9 + label.importance * 1.5 + scale * 6);
      ctx.font = `600 ${sizePx}px ${this.fontFamily}`;

      ctx.lineWidth = 3.4;
      ctx.strokeStyle = halo;
      ctx.strokeText(label.name, screen.x, screen.y + 8);
      ctx.fillStyle = ink;
      ctx.fillText(label.name, screen.x, screen.y + 8);

      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Feature names (river, pikes) drawn italic along their midpoints.
    ctx.textBaseline = "middle";
    const features = [...this.rivers, ...this.roads.filter((road) => road.styleKey === "road-primary")];
    for (const feature of features) {
      if (scale < 0.12 || feature.points.length < 2) {
        continue;
      }

      const midIndex = Math.floor(feature.points.length / 2);
      const a = feature.points[Math.max(0, midIndex - 1)];
      const b = feature.points[Math.min(feature.points.length - 1, midIndex + 1)];
      const mid = feature.points[midIndex];
      const screen = camera.worldToScreen(mid, viewport);
      if (screen.x < 0 || screen.y < 0 || screen.x > viewport.width || screen.y > viewport.height) {
        continue;
      }

      const aScreen = camera.worldToScreen(a, viewport);
      const bScreen = camera.worldToScreen(b, viewport);
      let angle = Math.atan2(bScreen.y - aScreen.y, bScreen.x - aScreen.x);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
        angle += Math.PI;
      }

      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(angle);
      ctx.font = `italic 600 12.5px ${this.fontFamily}`;
      ctx.strokeStyle = halo;
      ctx.lineWidth = 3;
      ctx.strokeText(feature.name, 0, -10);
      ctx.fillStyle = feature.styleKey === "river-main" ? this.mixRiverLabel(night) : ink;
      ctx.fillText(feature.name, 0, -10);
      ctx.restore();
    }
  }

  private mixLabelColor(night: number): string {
    const r = Math.round(74 + (222 - 74) * night);
    const g = Math.round(56 + (206 - 56) * night);
    const b = Math.round(35 + (168 - 35) * night);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private mixRiverLabel(night: number): string {
    const r = Math.round(62 + (170 - 62) * night);
    const g = Math.round(88 + (196 - 88) * night);
    const b = Math.round(110 + (214 - 110) * night);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private paintFormationLabels(
    ctx: CanvasRenderingContext2D,
    camera: CameraController,
    viewport: Viewport,
    frame: FrameState,
    anchors: FormationScreenAnchor[],
    night: number,
  ) {
    const showAll = camera.current.scale > 0.21;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    for (const anchor of anchors) {
      const formation = this.formationById.get(anchor.formationId);
      if (!formation) {
        continue;
      }

      const emphasized = frame.selectedFormationId === anchor.formationId
        || frame.hoveredFormationId === anchor.formationId;
      if (!showAll && !emphasized) {
        continue;
      }

      if (anchor.x < -60 || anchor.y < -40
        || anchor.x > viewport.width + 60 || anchor.y > viewport.height + 40) {
        continue;
      }

      const union = formation.side === "Union";
      ctx.font = `700 ${emphasized ? 13 : 11}px ${this.fontFamily}`;
      ctx.strokeStyle = night > 0.5 ? "rgba(8, 10, 18, 0.8)" : "rgba(240, 230, 202, 0.9)";
      ctx.lineWidth = 3.2;
      const labelY = anchor.y - anchor.radiusPx - 6;
      ctx.strokeText(shortName(formation.name), anchor.x, labelY);
      ctx.fillStyle = emphasized
        ? COLORS.gold
        : union
          ? this.mixSideLabel(night, [42, 84, 140], [150, 182, 226])
          : this.mixSideLabel(night, [140, 58, 42], [226, 156, 138]);
      ctx.fillText(shortName(formation.name), anchor.x, labelY);
    }
  }

  private mixSideLabel(night: number, day: [number, number, number], nightColor: [number, number, number]): string {
    const r = Math.round(day[0] + (nightColor[0] - day[0]) * night);
    const g = Math.round(day[1] + (nightColor[1] - day[1]) * night);
    const b = Math.round(day[2] + (nightColor[2] - day[2]) * night);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private paintCompassAndScale(
    ctx: CanvasRenderingContext2D,
    camera: CameraController,
    viewport: Viewport,
    night: number,
  ) {
    const ink = night > 0.5 ? "rgba(214, 198, 158, 0.85)" : "rgba(74, 56, 35, 0.8)";

    // Compass rose, rotating with the camera bearing.
    const cx = 54;
    const cy = viewport.height - 60;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(camera.current.bearing);
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(5, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = `700 11px ${this.fontFamily}`;
    ctx.fillText("N", 0, -28);
    ctx.restore();

    // Scale bar in yards.
    const metersPerPixel = 1 / camera.current.scale;
    const targetMeters = 110 * metersPerPixel;
    const yardOptions = [100, 200, 400, 800, 1600, 3200];
    const yards = yardOptions.reduce((best, candidate) =>
      Math.abs(candidate * 0.9144 - targetMeters) < Math.abs(best * 0.9144 - targetMeters)
        ? candidate
        : best,
    yardOptions[0]);
    const barPx = (yards * 0.9144) * camera.current.scale;

    const barX = viewport.width - barPx - 26;
    const barY = viewport.height - 34;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(barX, barY - 5);
    ctx.lineTo(barX, barY);
    ctx.lineTo(barX + barPx, barY);
    ctx.lineTo(barX + barPx, barY - 5);
    ctx.moveTo(barX + barPx / 2, barY);
    ctx.lineTo(barX + barPx / 2, barY - 4);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = `600 10.5px ${this.fontFamily}`;
    ctx.fillText(`${yards.toLocaleString()} yards`, barX + barPx / 2, barY - 8);
  }
}
