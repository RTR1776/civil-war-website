import type { GeoJSON, Geometry } from "geojson";

export type Side = "Union" | "Confederate";

export type ConfidenceLevel = "documented" | "inferred";

export type SidebarMode = "story" | "analyze" | "evidence";

export type MapMode = "reconstructed" | "modern";

export type InterpolationHint = "linear" | "hold" | "step-forward";

export interface EvidenceRef {
  sourceId: string;
  claimId?: string;
  note?: string;
  quote?: string;
}

export interface BattlefieldBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TerrainConfig {
  verticalScale: number;
  roughness: number;
}

export interface ScenarioManifest {
  id: string;
  schemaVersion: number;
  name: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  timezone: string;
  bounds: BattlefieldBounds;
  terrain: TerrainConfig;
  defaultMode: SidebarMode;
  mapModes: MapMode[];
  chapterOrder: string[];
}

export type FormationArm = "infantry" | "cavalry";

export interface Formation {
  id: string;
  name: string;
  side: Side;
  /** Branch of service; infantry when omitted. */
  arm?: FormationArm;
  commander: string;
  strengthEstimate: number;
  corps?: string;
  army?: string;
  casualtyEstimate?: number;
  notes?: string;
  confidence?: ConfidenceLevel;
  evidenceRefs?: EvidenceRef[];
}

export interface MovementPosition {
  formationId: string;
  lat: number;
  lng: number;
  elevation?: number;
  formation?: string;
  engaged?: boolean;
  uncertaintyMeters?: number;
  evidenceRefs?: EvidenceRef[];
}

export interface MovementKeyframe {
  timestamp: string;
  positions: MovementPosition[];
  confidence: ConfidenceLevel;
  interpolationHint: InterpolationHint;
  evidenceRefs?: EvidenceRef[];
}

export interface CameraPose {
  lat: number;
  lng: number;
  distance: number;
  pitch: number;
  yaw: number;
}

export interface CameraRailKeyframe {
  timeOffsetMs: number;
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
  overlayText?: string;
  eventId?: string;
  focusFormationIds?: string[];
}

export interface NarrativeBeat {
  id: string;
  time: string;
  title: string;
  description: string;
  cameraPose: CameraPose;
  focusFormationIds: string[];
  confidence: ConfidenceLevel;
  evidenceRefs: EvidenceRef[];
}

export interface ChapterScene {
  id: string;
  title: string;
  summary: string;
  startTime: string;
  endTime: string;
  beatIds: string[];
  pivotalEventId?: string;
  cameraRail: CameraRailKeyframe[];
  evidenceRefs: EvidenceRef[];
}

export interface MapLabel {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  importance: number;
  confidence: ConfidenceLevel;
  evidenceRefs: EvidenceRef[];
}

export interface SourceCitation {
  id: string;
  title: string;
  author: string;
  year: number;
  url?: string;
  note: string;
}

export interface EvidenceClaim {
  id: string;
  title: string;
  detail: string;
  confidence: ConfidenceLevel;
  linkedEventIds?: string[];
  linkedBeatIds?: string[];
  linkedChapterIds?: string[];
  evidenceRefs: EvidenceRef[];
}

export interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  confidence: ConfidenceLevel;
  evidenceRefs: EvidenceRef[];
}

export interface CasualtyTick {
  time: string;
  cumulativeCasualties: number;
  confidence: ConfidenceLevel;
  note?: string;
}

export interface MapLayerFeatureProperties {
  id: string;
  name: string;
  category: "road" | "river" | "terrain" | "works" | "landmark" | "sector";
  styleKey: string;
  confidence: ConfidenceLevel;
  evidenceRefs: EvidenceRef[];
}

export interface MapLayerFeature {
  type: "Feature";
  geometry: Geometry;
  properties: MapLayerFeatureProperties;
}

export interface MapLayerPack {
  id: string;
  name: string;
  description?: string;
  features: MapLayerFeature[];
}

export interface ScenarioDataBundle {
  manifest: ScenarioManifest;
  formations: Formation[];
  movementKeyframes: MovementKeyframe[];
  narrativeBeats: NarrativeBeat[];
  chapters: ChapterScene[];
  mapLabels: MapLabel[];
  timelineEvents: TimelineEvent[];
  casualtyTimeline: CasualtyTick[];
  mapLayerPack: MapLayerPack;
  evidenceSources: SourceCitation[];
  evidenceClaims: EvidenceClaim[];
}

export interface InterpolatedFormationPosition {
  formationId: string;
  unitId: string;
  lat: number;
  lng: number;
  engaged: boolean;
  formation?: string;
  confidence: ConfidenceLevel;
  uncertaintyMeters?: number;
}

export type BattleManifest = ScenarioManifest;
export type DivisionUnit = Formation;

export interface UnitPosition extends Omit<MovementPosition, "formationId"> {
  unitId: string;
}

export interface TimeSlice {
  timestamp: string;
  unitPositions: UnitPosition[];
  confidence: ConfidenceLevel;
}

export type BattleDataBundle = ScenarioDataBundle;

export type MapLayerGeoJson = GeoJSON;
