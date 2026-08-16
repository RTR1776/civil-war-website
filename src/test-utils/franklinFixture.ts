import manifestJson from "../../public/data/franklin/manifest.json";
import divisionsJson from "../../public/data/franklin/divisions.json";
import eventsJson from "../../public/data/franklin/events.json";
import sourcesJson from "../../public/data/franklin/sources.json";
import chaptersJson from "../../public/data/franklin/chapters.json";
import mapLayersJson from "../../public/data/franklin/mapLayers.json";
import evidenceJson from "../../public/data/franklin/evidence.json";

import { buildScenarioBundle } from "@/lib/battle/scenarioLoader";
import type {
  ChapterScene,
  MapLayerPack,
  ScenarioManifest,
  SourceCitation,
} from "@/lib/battle/types";

type ScenarioFiles = Parameters<typeof buildScenarioBundle>[0];

/**
 * The real Franklin scenario files, cast from JSON's widened literal types to
 * the loader's input shapes (the runtime loader performs the same trust).
 */
export const franklinFiles: ScenarioFiles = {
  manifest: manifestJson as unknown as ScenarioManifest,
  divisions: divisionsJson as unknown as ScenarioFiles["divisions"],
  events: eventsJson as unknown as ScenarioFiles["events"],
  sources: sourcesJson as unknown as SourceCitation[],
  chapters: chaptersJson as unknown as ChapterScene[],
  mapLayers: mapLayersJson as unknown as MapLayerPack,
  evidence: evidenceJson as unknown as ScenarioFiles["evidence"],
};

export function buildFranklinBundle() {
  return buildScenarioBundle(franklinFiles);
}
