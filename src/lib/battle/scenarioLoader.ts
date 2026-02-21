import type {
  BattleManifest,
  ChapterScene,
  EvidenceClaim,
  MapLabel,
  MapLayerPack,
  MovementKeyframe,
  NarrativeBeat,
  ScenarioDataBundle,
  ScenarioManifest,
  SourceCitation,
  TimelineEvent,
} from "@/lib/battle/types";

interface LegacyDivisionsPayload {
  units: ScenarioDataBundle["formations"];
  timeSlices: Array<{
    timestamp: string;
    confidence: "documented" | "inferred";
    unitPositions: Array<{
      unitId: string;
      lat: number;
      lng: number;
      elevation?: number;
      formation?: string;
      engaged?: boolean;
    }>;
  }>;
}

interface LegacyEventsPayload {
  narrativeBeats: Array<{
    id: string;
    time: string;
    title: string;
    description: string;
    cameraPose: {
      lat: number;
      lng: number;
      distance: number;
      pitch: number;
      yaw: number;
    };
    focusUnitIds?: string[];
    focusFormationIds?: string[];
    confidence?: "documented" | "inferred";
    evidenceRefs?: Array<{ sourceId: string; claimId?: string; note?: string; quote?: string }>;
  }>;
  mapLabels: Array<MapLabel>;
  timelineEvents: Array<TimelineEvent>;
  casualtyTimeline: ScenarioDataBundle["casualtyTimeline"];
}

interface EvidencePayload {
  claims: EvidenceClaim[];
}

interface ScenarioFileSet {
  manifest: ScenarioManifest | BattleManifest;
  divisions: LegacyDivisionsPayload;
  events: LegacyEventsPayload;
  sources: SourceCitation[];
  chapters?: ChapterScene[];
  mapLayers?: MapLayerPack;
  evidence?: EvidencePayload;
}

export async function fetchJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<T | null> {
  const response = await fetcher(url);
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizeManifest(manifest: ScenarioManifest | BattleManifest, chapters: ChapterScene[]): ScenarioManifest {
  return {
    ...manifest,
    schemaVersion: "schemaVersion" in manifest ? manifest.schemaVersion : 2,
    defaultMode: "defaultMode" in manifest ? manifest.defaultMode : "story",
    mapModes: "mapModes" in manifest ? manifest.mapModes : ["reconstructed", "modern"],
    chapterOrder:
      "chapterOrder" in manifest && manifest.chapterOrder.length > 0
        ? manifest.chapterOrder
        : chapters.map((chapter) => chapter.id),
  };
}

function buildFallbackMapLayers(): MapLayerPack {
  return {
    id: "franklin-historic-layers",
    name: "Franklin 1864 Reconstruction",
    description: "Roads, works, and terrain landmarks reconstructed from battle studies.",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.8598, 35.9093],
            [-86.8596, 35.9152],
            [-86.8593, 35.9208],
            [-86.8596, 35.925],
          ],
        },
        properties: {
          id: "road-columbia-pike",
          name: "Columbia Pike (1864)",
          category: "road",
          styleKey: "road-primary",
          confidence: "documented",
          evidenceRefs: [{ sourceId: "source-opdycke-1880" }],
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.874, 35.9222],
            [-86.8696, 35.9225],
            [-86.8654, 35.9226],
            [-86.8614, 35.9224],
            [-86.8572, 35.9222],
            [-86.8528, 35.9231],
          ],
        },
        properties: {
          id: "works-federal-main",
          name: "Federal Main Works",
          category: "works",
          styleKey: "works-main",
          confidence: "documented",
          evidenceRefs: [{ sourceId: "source-jacobs-2006" }],
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.8716, 35.9264],
            [-86.8685, 35.9276],
            [-86.8649, 35.928],
            [-86.8602, 35.9275],
            [-86.8558, 35.9268],
          ],
        },
        properties: {
          id: "river-harpeth",
          name: "Harpeth River",
          category: "river",
          styleKey: "river-main",
          confidence: "documented",
          evidenceRefs: [{ sourceId: "source-atlas-1864" }],
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-86.8602, 35.923],
              [-86.8588, 35.923],
              [-86.8588, 35.9219],
              [-86.8602, 35.9219],
              [-86.8602, 35.923],
            ],
          ],
        },
        properties: {
          id: "landmark-carter-house",
          name: "Carter House Sector",
          category: "landmark",
          styleKey: "landmark-core",
          confidence: "inferred",
          evidenceRefs: [{ sourceId: "source-jacobs-2006" }],
        },
      },
    ],
  };
}

function buildFallbackChapters(
  beats: NarrativeBeat[],
  timelineEvents: TimelineEvent[],
): ChapterScene[] {
  const orderedBeats = [...beats].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

  return orderedBeats.map((beat, index) => {
    const nextBeat = orderedBeats[index + 1];
    const sameTimeEvent = timelineEvents.find((event) => event.time === beat.time);

    return {
      id: `chapter-${beat.id}`,
      title: beat.title,
      summary: beat.description,
      startTime: beat.time,
      endTime: nextBeat?.time ?? beat.time,
      beatIds: [beat.id],
      pivotalEventId: sameTimeEvent?.id,
      cameraRail: [
        {
          timeOffsetMs: 0,
          lat: beat.cameraPose.lat,
          lng: beat.cameraPose.lng,
          zoom: 14.2,
          pitch: Math.min(65, beat.cameraPose.pitch + 14),
          bearing: beat.cameraPose.yaw,
          overlayText: beat.title,
          focusFormationIds: beat.focusFormationIds,
        },
      ],
      evidenceRefs: beat.evidenceRefs.length > 0 ? beat.evidenceRefs : [{ sourceId: "source-jacobs-2006" }],
    };
  });
}

function adaptMovementKeyframes(divisions: LegacyDivisionsPayload): MovementKeyframe[] {
  return divisions.timeSlices.map((timeSlice) => ({
    timestamp: timeSlice.timestamp,
    confidence: timeSlice.confidence,
    interpolationHint: "linear",
    positions: timeSlice.unitPositions.map((position) => ({
      formationId: position.unitId,
      lat: position.lat,
      lng: position.lng,
      elevation: position.elevation,
      formation: position.formation,
      engaged: position.engaged,
      uncertaintyMeters: timeSlice.confidence === "inferred" ? 110 : 45,
    })),
  }));
}

function adaptNarrativeBeats(events: LegacyEventsPayload): NarrativeBeat[] {
  return events.narrativeBeats.map((beat) => ({
    id: beat.id,
    time: beat.time,
    title: beat.title,
    description: beat.description,
    cameraPose: beat.cameraPose,
    focusFormationIds: beat.focusFormationIds ?? beat.focusUnitIds ?? [],
    confidence: beat.confidence ?? "documented",
    evidenceRefs: beat.evidenceRefs ?? [{ sourceId: "source-jacobs-2006" }],
  }));
}

function adaptTimelineEvents(events: LegacyEventsPayload): TimelineEvent[] {
  return events.timelineEvents.map((event) => ({
    ...event,
    evidenceRefs: event.evidenceRefs ?? [{ sourceId: "source-jacobs-2006" }],
  }));
}

function adaptMapLabels(events: LegacyEventsPayload): MapLabel[] {
  return events.mapLabels.map((label) => ({
    ...label,
    confidence: label.confidence ?? "documented",
    evidenceRefs: label.evidenceRefs ?? [{ sourceId: "source-jacobs-2006" }],
  }));
}

function buildFallbackEvidenceClaims(
  timelineEvents: TimelineEvent[],
  chapters: ChapterScene[],
): EvidenceClaim[] {
  return timelineEvents.map((event) => ({
    id: `claim-${event.id}`,
    title: event.title,
    detail: event.detail,
    confidence: event.confidence,
    linkedEventIds: [event.id],
    linkedChapterIds: chapters.filter((chapter) => chapter.pivotalEventId === event.id).map((chapter) => chapter.id),
    evidenceRefs: event.evidenceRefs,
  }));
}

export function buildScenarioBundle(files: ScenarioFileSet): ScenarioDataBundle {
  const narrativeBeats = adaptNarrativeBeats(files.events);
  const timelineEvents = adaptTimelineEvents(files.events);
  const chapters = files.chapters && files.chapters.length > 0
    ? files.chapters
    : buildFallbackChapters(narrativeBeats, timelineEvents);

  const manifest = normalizeManifest(files.manifest, chapters);

  const evidenceClaims =
    files.evidence?.claims && files.evidence.claims.length > 0
      ? files.evidence.claims
      : buildFallbackEvidenceClaims(timelineEvents, chapters);

  return {
    manifest,
    formations: files.divisions.units,
    movementKeyframes: adaptMovementKeyframes(files.divisions),
    narrativeBeats,
    chapters,
    mapLabels: adaptMapLabels(files.events),
    timelineEvents,
    casualtyTimeline: files.events.casualtyTimeline,
    mapLayerPack: files.mapLayers ?? buildFallbackMapLayers(),
    evidenceSources: files.sources,
    evidenceClaims,
  };
}

export async function loadScenarioData(
  scenarioPath = "/data/franklin",
  fetcher: typeof fetch = fetch,
): Promise<ScenarioDataBundle> {
  const [manifest, divisions, events, sources, chapters, mapLayers, evidence] = await Promise.all([
    fetchJson<ScenarioManifest | BattleManifest>(`${scenarioPath}/manifest.json`, fetcher),
    fetchJson<LegacyDivisionsPayload>(`${scenarioPath}/divisions.json`, fetcher),
    fetchJson<LegacyEventsPayload>(`${scenarioPath}/events.json`, fetcher),
    fetchJson<SourceCitation[]>(`${scenarioPath}/sources.json`, fetcher),
    fetchOptionalJson<ChapterScene[]>(`${scenarioPath}/chapters.json`, fetcher),
    fetchOptionalJson<MapLayerPack>(`${scenarioPath}/mapLayers.json`, fetcher),
    fetchOptionalJson<EvidencePayload>(`${scenarioPath}/evidence.json`, fetcher),
  ]);

  return buildScenarioBundle({
    manifest,
    divisions,
    events,
    sources,
    chapters: chapters ?? undefined,
    mapLayers: mapLayers ?? undefined,
    evidence: evidence ?? undefined,
  });
}
