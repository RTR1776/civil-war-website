#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const scenarioDir = process.argv[2] ?? "public/data/franklin";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function toMovementTracks(divisions) {
  const trackByUnit = new Map();

  for (const slice of divisions.timeSlices) {
    const timestamp = Date.parse(slice.timestamp);
    for (const position of slice.unitPositions) {
      const current = trackByUnit.get(position.unitId) ?? [];
      current.push({
        t: timestamp,
        lat: position.lat,
        lng: position.lng,
        engaged: Boolean(position.engaged),
        confidence: slice.confidence,
      });
      trackByUnit.set(position.unitId, current);
    }
  }

  return [...trackByUnit.entries()].map(([unitId, points]) => ({
    unitId,
    points: points.sort((a, b) => a.t - b.t),
  }));
}

async function main() {
  const root = process.cwd();
  const base = path.join(root, scenarioDir);

  const [manifest, divisions, events, chapters, mapLayers, evidence] = await Promise.all([
    readJson(path.join(base, "manifest.json")),
    readJson(path.join(base, "divisions.json")),
    readJson(path.join(base, "events.json")),
    readJson(path.join(base, "chapters.json")),
    readJson(path.join(base, "mapLayers.json")),
    readJson(path.join(base, "evidence.json")),
  ]);

  const output = {
    scenarioId: manifest.id,
    builtAt: new Date().toISOString(),
    window: {
      start: manifest.timeStart,
      end: manifest.timeEnd,
    },
    tracks: toMovementTracks(divisions),
    narrative: {
      chapters,
      beats: events.narrativeBeats,
      timelineEvents: events.timelineEvents,
    },
    mapLayers,
    evidence,
  };

  const outPath = path.join(base, "render-pack.json");
  await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${path.relative(root, outPath)}`);
}

void main();
