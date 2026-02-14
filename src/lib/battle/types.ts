export type Side = "Union" | "Confederate";

export type ConfidenceLevel = "documented" | "inferred";

export interface BattlefieldBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TerrainConfig {
  verticalScale: number;
  roughness: number;
  demGridPath?: string;
  demVerticalExaggeration?: number;
}

export interface BattleManifest {
  id: string;
  name: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  timezone: string;
  bounds: BattlefieldBounds;
  terrain: TerrainConfig;
}

export interface DivisionUnit {
  id: string;
  name: string;
  side: Side;
  commander: string;
  strengthEstimate: number;
}

export interface UnitPosition {
  unitId: string;
  lat: number;
  lng: number;
  elevation?: number;
  formation?: string;
  engaged?: boolean;
}

export interface TimeSlice {
  timestamp: string;
  unitPositions: UnitPosition[];
  confidence: ConfidenceLevel;
}

export interface CameraPose {
  lat: number;
  lng: number;
  distance: number;
  pitch: number;
  yaw: number;
}

export interface NarrativeBeat {
  id: string;
  time: string;
  title: string;
  description: string;
  cameraPose: CameraPose;
  focusUnitIds: string[];
}

export interface MapLabel {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  importance: number;
}

export interface SourceCitation {
  id: string;
  title: string;
  author: string;
  year: number;
  url?: string;
  note: string;
}

export interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  confidence: ConfidenceLevel;
}

export interface BattleDataBundle {
  manifest: BattleManifest;
  units: DivisionUnit[];
  timeSlices: TimeSlice[];
  narrativeBeats: NarrativeBeat[];
  mapLabels: MapLabel[];
  timelineEvents: TimelineEvent[];
  sources: SourceCitation[];
  terrainDem: TerrainDem | null;
}

export interface InterpolatedUnitPosition {
  unitId: string;
  lat: number;
  lng: number;
  engaged: boolean;
  formation?: string;
  confidence: ConfidenceLevel;
}

export interface TerrainDem {
  source: string;
  generatedAt: string;
  query: string;
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  noDataValue: number | null;
  bbox: BattlefieldBounds;
  heights: Array<number | null>;
}
