import { CameraController } from "@/features/battlefield/engine/camera";
import { chapterPoseAt, overviewPose } from "@/features/battlefield/engine/direction";
import {
  createProjection,
  zoomToPixelsPerMeter,
} from "@/features/battlefield/engine/projection";
import { createRng } from "@/features/battlefield/engine/rand";
import type { ChapterScene } from "@/lib/battle/types";

const BOUNDS = { north: 35.9368, south: 35.903, east: -86.805, west: -86.892 };

describe("projection", () => {
  it("round-trips lat/lng through world coordinates", () => {
    const projection = createProjection(BOUNDS);
    const world = projection.toWorld(35.9224, -86.8597);
    const back = projection.toLatLng(world);

    expect(back.lat).toBeCloseTo(35.9224, 6);
    expect(back.lng).toBeCloseTo(-86.8597, 6);
  });

  it("has sane world dimensions for the Franklin bounds", () => {
    const projection = createProjection(BOUNDS);
    expect(projection.widthM).toBeGreaterThan(7000);
    expect(projection.widthM).toBeLessThan(9000);
    expect(projection.heightM).toBeGreaterThan(3000);
    expect(projection.heightM).toBeLessThan(4500);
  });

  it("maps mapbox zoom levels to plausible scales", () => {
    const scale14 = zoomToPixelsPerMeter(14, 35.92);
    expect(1 / scale14).toBeGreaterThan(3);
    expect(1 / scale14).toBeLessThan(4.5);
    expect(zoomToPixelsPerMeter(15, 35.92)).toBeCloseTo(scale14 * 2, 5);
  });
});

describe("camera", () => {
  it("inverts worldToScreen with screenToWorld, including bearing", () => {
    const camera = new CameraController({ x: 120, y: -60, scale: 0.3, bearing: 0.4 });
    const viewport = { width: 1200, height: 800 };
    const screen = camera.worldToScreen({ x: 500, y: 250 }, viewport);
    const world = camera.screenToWorld(screen.x, screen.y, viewport);

    expect(world.x).toBeCloseTo(500, 6);
    expect(world.y).toBeCloseTo(250, 6);
  });

  it("eases toward its target and settles", () => {
    const camera = new CameraController({ x: 0, y: 0, scale: 0.2, bearing: 0 });
    camera.easeTo({ x: 400, y: 300, scale: 0.4 });

    for (let frame = 0; frame < 400; frame += 1) {
      camera.update(16);
    }

    expect(camera.current.x).toBeCloseTo(400, 1);
    expect(camera.current.y).toBeCloseTo(300, 1);
    expect(camera.current.scale).toBeCloseTo(0.4, 3);
    expect(camera.isSettled()).toBe(true);
  });

  it("keeps the anchor fixed while zooming around a point", () => {
    const camera = new CameraController({ x: 0, y: 0, scale: 0.2, bearing: 0 });
    const viewport = { width: 1000, height: 700 };
    const anchorBefore = camera.screenToWorld(250, 180, viewport);

    camera.zoomAround(250, 180, 1.8, viewport);
    const anchorAfter = camera.screenToWorld(250, 180, viewport);

    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 4);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 4);
  });
});

describe("direction", () => {
  const projection = createProjection(BOUNDS);

  const chapter: ChapterScene = {
    id: "chapter-test",
    title: "Test",
    summary: "Test",
    startTime: "1864-11-30T15:00:00-06:00",
    endTime: "1864-11-30T17:00:00-06:00",
    beatIds: [],
    cameraRail: [
      { timeOffsetMs: 0, lat: 35.916, lng: -86.86, zoom: 14, pitch: 40, bearing: 0 },
      { timeOffsetMs: 7_200_000, lat: 35.922, lng: -86.859, zoom: 14.8, pitch: 50, bearing: 20 },
    ],
    evidenceRefs: [{ sourceId: "source-1" }],
  };

  it("interpolates the camera rail across the chapter's sim-time span", () => {
    const startPose = chapterPoseAt(chapter, Date.parse(chapter.startTime), projection);
    const midPose = chapterPoseAt(chapter, Date.parse(chapter.startTime) + 3_600_000, projection);
    const endPose = chapterPoseAt(chapter, Date.parse(chapter.endTime), projection);

    expect(startPose).not.toBeNull();
    expect(midPose).not.toBeNull();
    expect(endPose).not.toBeNull();

    // Mid pose sits strictly between the endpoints.
    expect(midPose!.y).toBeLessThan(startPose!.y);
    expect(midPose!.y).toBeGreaterThan(endPose!.y);
    expect(midPose!.scale).toBeGreaterThan(startPose!.scale);
    expect(midPose!.scale).toBeLessThan(endPose!.scale);
    expect(endPose!.bearing).toBeCloseTo((20 * Math.PI) / 180, 5);
  });

  it("frames the whole battlefield in the overview pose", () => {
    const pose = overviewPose(projection, 1280, 800);
    expect(pose.scale * projection.widthM).toBeLessThanOrEqual(1280);
    expect(pose.scale * projection.widthM).toBeGreaterThan(600);
  });
});

describe("seeded rng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let draw = 0; draw < 20; draw += 1) {
      expect(a()).toBe(b());
    }
  });
});
