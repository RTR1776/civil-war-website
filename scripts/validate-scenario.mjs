#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const scenarioDir = process.argv[2] ?? "public/data/franklin";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

async function main() {
  const root = process.cwd();
  const base = path.join(root, scenarioDir);

  const [manifest, divisions, events, sources, chapters, mapLayers, evidence] = await Promise.all([
    readJson(path.join(base, "manifest.json")),
    readJson(path.join(base, "divisions.json")),
    readJson(path.join(base, "events.json")),
    readJson(path.join(base, "sources.json")),
    readJson(path.join(base, "chapters.json")),
    readJson(path.join(base, "mapLayers.json")),
    readJson(path.join(base, "evidence.json")),
  ]);

  const errors = [];
  const sourceIds = new Set(sources.map((source) => source.id));
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const eventIds = new Set(events.timelineEvents.map((event) => event.id));
  const beatIds = new Set(events.narrativeBeats.map((beat) => beat.id));

  assert(manifest.schemaVersion >= 2, "manifest.schemaVersion must be >= 2", errors);
  assert(Array.isArray(manifest.chapterOrder), "manifest.chapterOrder must be an array", errors);

  for (const chapter of chapters) {
    assert(chapter.evidenceRefs?.length > 0, `chapter ${chapter.id} missing evidenceRefs`, errors);
    assert(chapter.cameraRail?.length > 0, `chapter ${chapter.id} missing cameraRail`, errors);

    for (const beatId of chapter.beatIds ?? []) {
      assert(beatIds.has(beatId), `chapter ${chapter.id} references unknown beat ${beatId}`, errors);
    }

    if (chapter.pivotalEventId) {
      assert(
        eventIds.has(chapter.pivotalEventId),
        `chapter ${chapter.id} references unknown pivotal event ${chapter.pivotalEventId}`,
        errors,
      );
    }

    for (const reference of chapter.evidenceRefs ?? []) {
      assert(
        sourceIds.has(reference.sourceId),
        `chapter ${chapter.id} references unknown source ${reference.sourceId}`,
        errors,
      );
    }
  }

  for (const claim of evidence.claims ?? []) {
    for (const reference of claim.evidenceRefs ?? []) {
      assert(sourceIds.has(reference.sourceId), `claim ${claim.id} references unknown source ${reference.sourceId}`, errors);
    }

    for (const linkedChapterId of claim.linkedChapterIds ?? []) {
      assert(chapterIds.has(linkedChapterId), `claim ${claim.id} references unknown chapter ${linkedChapterId}`, errors);
    }
  }

  for (const feature of mapLayers.features ?? []) {
    assert(feature.properties?.evidenceRefs?.length > 0, `map feature ${feature.properties?.id ?? "unknown"} missing evidenceRefs`, errors);

    for (const reference of feature.properties?.evidenceRefs ?? []) {
      assert(
        sourceIds.has(reference.sourceId),
        `map feature ${feature.properties?.id ?? "unknown"} references unknown source ${reference.sourceId}`,
        errors,
      );
    }
  }

  for (const slice of divisions.timeSlices ?? []) {
    assert(slice.unitPositions?.length > 0, `timeSlice ${slice.timestamp} missing unitPositions`, errors);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(`Scenario validation passed for ${scenarioDir}`);
}

void main();
