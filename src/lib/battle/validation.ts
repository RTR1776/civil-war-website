import type {
  ChapterScene,
  ScenarioDataBundle,
  ScenarioManifest,
} from "@/lib/battle/types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function parseRange(manifest: ScenarioManifest): { start: number; end: number } {
  return {
    start: Date.parse(manifest.timeStart),
    end: Date.parse(manifest.timeEnd),
  };
}

function validateChapterScene(
  chapter: ChapterScene,
  range: { start: number; end: number },
  timelineEventIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const chapterStart = Date.parse(chapter.startTime);
  const chapterEnd = Date.parse(chapter.endTime);

  if (Number.isNaN(chapterStart) || Number.isNaN(chapterEnd)) {
    errors.push(`Chapter has invalid time range: ${chapter.id}`);
  }

  if (chapterStart < range.start || chapterEnd > range.end) {
    errors.push(`Chapter is outside scenario window: ${chapter.id}`);
  }

  if (chapter.evidenceRefs.length === 0) {
    errors.push(`Chapter requires evidence linkage: ${chapter.id}`);
  }

  if (chapter.cameraRail.length === 0) {
    errors.push(`Chapter requires at least one camera rail keyframe: ${chapter.id}`);
  }

  if (chapter.pivotalEventId && !timelineEventIds.has(chapter.pivotalEventId)) {
    errors.push(`Chapter references unknown pivotal event: ${chapter.id} -> ${chapter.pivotalEventId}`);
  }

  return errors;
}

export function validateScenarioData(bundle: ScenarioDataBundle): ValidationResult {
  const errors: string[] = [];
  const formationIds = new Set(bundle.formations.map((formation) => formation.id));
  const evidenceSourceIds = new Set(bundle.evidenceSources.map((source) => source.id));
  const timelineEventIds = new Set(bundle.timelineEvents.map((event) => event.id));
  const chapterIds = new Set(bundle.chapters.map((chapter) => chapter.id));
  const { start, end } = parseRange(bundle.manifest);

  for (const keyframe of bundle.movementKeyframes) {
    const current = Date.parse(keyframe.timestamp);

    if (Number.isNaN(current)) {
      errors.push(`Invalid movement timestamp format: ${keyframe.timestamp}`);
      continue;
    }

    if (current < start || current > end) {
      errors.push(`Movement timestamp outside scenario window: ${keyframe.timestamp}`);
    }

    for (const position of keyframe.positions) {
      if (!formationIds.has(position.formationId)) {
        errors.push(
          `Movement position references unknown formation id: ${position.formationId} (${keyframe.timestamp})`,
        );
      }
    }
  }

  for (const casualtyTick of bundle.casualtyTimeline) {
    const current = Date.parse(casualtyTick.time);

    if (Number.isNaN(current)) {
      errors.push(`Invalid casualty timestamp format: ${casualtyTick.time}`);
      continue;
    }

    if (current < start || current > end) {
      errors.push(`Casualty timestamp outside scenario window: ${casualtyTick.time}`);
    }
  }

  for (const chapter of bundle.chapters) {
    errors.push(...validateChapterScene(chapter, { start, end }, timelineEventIds));
  }

  for (const event of bundle.timelineEvents) {
    if (event.evidenceRefs.length === 0) {
      errors.push(`Timeline event requires evidence linkage: ${event.id}`);
    }

    for (const reference of event.evidenceRefs) {
      if (!evidenceSourceIds.has(reference.sourceId)) {
        errors.push(`Unknown evidence source reference in timeline event: ${event.id} -> ${reference.sourceId}`);
      }
    }
  }

  for (const beat of bundle.narrativeBeats) {
    if (beat.evidenceRefs.length === 0) {
      errors.push(`Narrative beat requires evidence linkage: ${beat.id}`);
    }

    for (const reference of beat.evidenceRefs) {
      if (!evidenceSourceIds.has(reference.sourceId)) {
        errors.push(`Unknown evidence source reference in narrative beat: ${beat.id} -> ${reference.sourceId}`);
      }
    }
  }

  for (const claim of bundle.evidenceClaims) {
    for (const reference of claim.evidenceRefs) {
      if (!evidenceSourceIds.has(reference.sourceId)) {
        errors.push(`Unknown evidence source reference in claim: ${claim.id} -> ${reference.sourceId}`);
      }
    }

    for (const chapterId of claim.linkedChapterIds ?? []) {
      if (!chapterIds.has(chapterId)) {
        errors.push(`Evidence claim references unknown chapter: ${claim.id} -> ${chapterId}`);
      }
    }
  }

  for (const chapterId of bundle.manifest.chapterOrder) {
    if (!chapterIds.has(chapterId)) {
      errors.push(`Manifest chapterOrder references unknown chapter: ${chapterId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateBattleData(bundle: ScenarioDataBundle): ValidationResult {
  return validateScenarioData(bundle);
}
