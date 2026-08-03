import type { OcrObservation, Rect } from "@umt/shared";
import type { GenericOcrRegion } from "./generic-ocr.js";

export type BubbleShape = "ellipse" | "rounded-rect" | "rect" | "free-text";

export interface BubbleOwnershipEvidence {
  observationId: string;
  manualGroupId?: string;
  visualGroupId?: string;
  componentBox?: Rect;
  shape?: BubbleShape;
  confidence: number;
  touchesBoundary: boolean;
}

export interface BubbleCandidateEvidence {
  ownership: "manual" | "visual" | "geometry" | "single";
  groupId?: string;
  confidence: number;
  touchesBoundary: boolean;
}

export interface BubbleCandidate {
  id: string;
  box: Rect;
  shape: BubbleShape;
  observationIds: string[];
  confidence: number;
  evidence: BubbleCandidateEvidence;
  sourceText: string;
  orientation: "horizontal" | "vertical";
  kind: "dialogue" | "narration" | "sfx";
}

type BubbleObservation = OcrObservation | GenericOcrRegion;

interface ObservationEntry {
  observation: BubbleObservation;
  evidence: BubbleOwnershipEvidence | undefined;
  observationIds: string[];
}

interface ObservationGroup {
  entries: ObservationEntry[];
  ownership: BubbleCandidateEvidence["ownership"];
  groupId?: string;
}

interface IdentifiedBubbleCandidate {
  candidate: BubbleCandidate;
  identity: string;
}

const HIGH_CONFIDENCE_VISUAL_GROUP = 0.72;

export function reconstructBubbles(
  observations: readonly BubbleObservation[],
  ownershipEvidence: readonly BubbleOwnershipEvidence[] = [],
): BubbleCandidate[] {
  const evidenceByObservationId = groupEvidenceByObservationId(ownershipEvidence);
  const candidates = dedupeObservationEntries(observations
    .filter(isUsableObservation)
    .map((observation) => ({
      observation,
      evidence: selectPreferredEvidence(
        evidenceByObservationId.get(observation.id) ?? [],
        observation.id,
      ),
      observationIds: [observation.id],
    })))
    .sort(compareReadingOrder);
  const groups: ObservationGroup[] = [];

  for (const entry of candidates) {
    const manualGroup = entry.evidence?.manualGroupId
      ? groups.find((group) => group.ownership === "manual" && group.groupId === entry.evidence!.manualGroupId)
      : undefined;
    if (manualGroup && isKindAndOrientationCompatible(manualGroup, entry)) {
      manualGroup.entries.push(entry);
      continue;
    }

    const visualGroup = isHighConfidenceVisualEvidence(entry.evidence)
      ? groups.find((group) => group.ownership === "visual" && group.groupId === entry.evidence!.visualGroupId)
      : undefined;
    if (visualGroup && isKindAndOrientationCompatible(visualGroup, entry)) {
      visualGroup.entries.push(entry);
      continue;
    }

    const previous = groups.at(-1);
    if (previous && canFallbackJoin(previous, entry)) {
      previous.entries.push(entry);
      if (previous.ownership === "single") previous.ownership = "geometry";
      continue;
    }

    const manualGroupId = entry.evidence?.manualGroupId;
    const visualGroupId = isHighConfidenceVisualEvidence(entry.evidence) ? entry.evidence.visualGroupId : undefined;
    const nextGroup: ObservationGroup = {
      entries: [entry],
      ownership: manualGroupId ? "manual" : visualGroupId ? "visual" : "single",
    };
    const groupId = manualGroupId ?? visualGroupId;
    if (groupId) nextGroup.groupId = groupId;
    groups.push(nextGroup);
  }

  const identified = groups
    .map(toBubbleCandidate)
    .sort((left, right) => (
      compareBubbleReadingOrder(left.candidate, right.candidate)
      || left.identity.localeCompare(right.identity)
    ));
  return ensureUniqueBubbleIds(identified);
}

function canFallbackJoin(group: ObservationGroup, next: ObservationEntry): boolean {
  if (!isKindAndOrientationCompatible(group, next)) return false;
  if (next.observation.kind === "sfx") return false;
  if (group.ownership === "manual" || group.ownership === "visual") return false;
  if (next.evidence?.manualGroupId || isHighConfidenceVisualEvidence(next.evidence)) return false;
  if (next.evidence?.shape === "free-text" || group.entries.some((entry) => entry.evidence?.shape === "free-text")) return false;
  if (group.entries.some((entry) => hasConflictingOwnership(entry.evidence, next.evidence))) return false;
  if (next.observation.orientation === "vertical") return false;
  return canJoinHorizontal(group.entries, next);
}

function canJoinHorizontal(group: ObservationEntry[], next: ObservationEntry): boolean {
  const union = unionRect(group.map((entry) => entry.observation.box));
  const previous = group.at(-1)!.observation.box;
  const box = next.observation.box;
  const averageHeight = (previous.height + box.height) / 2;
  const overlapY = overlapLength(union.y, union.height, box.y, box.height);
  const sameLine = overlapY >= Math.min(union.height, box.height) * 0.65;
  if (sameLine) {
    const horizontalGap = gapBetween(union.x, union.width, box.x, box.width);
    return horizontalGap <= Math.max(6, averageHeight * 0.75);
  }

  const verticalGap = box.y - (previous.y + previous.height);
  if (verticalGap < -averageHeight * 0.2 || verticalGap > Math.max(8, averageHeight * 0.55)) return false;
  const overlapX = overlapLength(union.x, union.width, box.x, box.width);
  const minimumWidth = Math.min(union.width, box.width);
  const centerDistance = Math.abs(centerX(union) - centerX(box));
  const strongHorizontalOverlap = overlapX >= minimumWidth * 0.45;
  const centersClose = centerDistance <= Math.min(
    Math.max(union.width, box.width) * 0.28,
    averageHeight * 1.6,
  );
  return strongHorizontalOverlap || centersClose;
}

function hasConflictingOwnership(
  left: BubbleOwnershipEvidence | undefined,
  right: BubbleOwnershipEvidence | undefined,
): boolean {
  if (left?.manualGroupId && right?.manualGroupId && left.manualGroupId !== right.manualGroupId) return true;
  if (left?.visualGroupId && right?.visualGroupId && left.visualGroupId !== right.visualGroupId) return true;
  return false;
}

function isKindAndOrientationCompatible(group: ObservationGroup, next: ObservationEntry): boolean {
  const first = group.entries[0]!.observation;
  return first.kind === next.observation.kind
    && first.orientation === next.observation.orientation
    && first.kind !== "sfx";
}

function toBubbleCandidate(group: ObservationGroup): IdentifiedBubbleCandidate {
  const ordered = [...group.entries].sort(compareWithinBubble);
  const observations = ordered.map((entry) => entry.observation);
  const evidence = ordered.flatMap((entry) => entry.evidence ? [entry.evidence] : []);
  const componentBoxes = evidence
    .filter((item) => !item.touchesBoundary && item.confidence >= HIGH_CONFIDENCE_VISUAL_GROUP && item.componentBox)
    .map((item) => item.componentBox!);
  const observationBox = unionRect(observations.map((observation) => observation.box));
  const box = componentBoxes.length > 0
    ? unionRect(componentBoxes)
    : group.ownership === "geometry"
      ? padGeometryBox(observationBox)
      : observationBox;
  const selectedShape = evidence
    .filter((item) => !item.touchesBoundary && item.shape)
    .sort((a, b) => b.confidence - a.confidence)[0]?.shape ?? "free-text";
  const evidenceConfidence = evidence.length > 0
    ? evidence.reduce((sum, item) => sum + clampConfidence(item.confidence), 0) / evidence.length
    : 0;
  const observationConfidence = observations.reduce((sum, item) => sum + clampConfidence(item.confidence), 0) / observations.length;
  const evidenceSummary: BubbleCandidateEvidence = {
    ownership: group.ownership,
    confidence: evidenceConfidence,
    touchesBoundary: evidence.some((item) => item.touchesBoundary),
    ...(group.groupId ? { groupId: group.groupId } : {}),
  };
  const ids = ordered.flatMap((entry) => entry.observationIds);
  const sourceText = observations.map((observation) => observation.sourceText.trim()).join("\n");
  const identity = createStableBubbleIdentity(
    selectedShape,
    box,
    sourceText,
    observations[0]!.orientation,
    observations[0]!.kind,
    group.ownership === "visual" ? group.groupId : undefined,
  );
  return {
    identity,
    candidate: {
      id: createStableBubbleId(identity),
      box,
      shape: selectedShape,
      observationIds: ids,
      confidence: evidence.length > 0
        ? clampConfidence(observationConfidence * 0.7 + evidenceConfidence * 0.3)
        : observationConfidence,
      evidence: evidenceSummary,
      sourceText,
      orientation: observations[0]!.orientation,
      kind: observations[0]!.kind,
    },
  };
}

function padGeometryBox(box: Rect): Rect {
  const padX = Math.max(8, Math.round(box.width * 0.03));
  const padY = Math.max(8, Math.round(box.height * 0.05));
  return {
    x: box.x - padX,
    y: box.y - padY,
    width: box.width + padX * 2,
    height: box.height + padY * 2,
  };
}

function compareWithinBubble(left: ObservationEntry, right: ObservationEntry): number {
  if (left.observation.orientation === "vertical" && right.observation.orientation === "vertical") {
    return right.observation.box.x - left.observation.box.x
      || left.observation.box.y - right.observation.box.y;
  }
  return left.observation.box.y - right.observation.box.y
    || left.observation.box.x - right.observation.box.x;
}

function compareReadingOrder(left: ObservationEntry, right: ObservationEntry): number {
  return compareObservations(left.observation, right.observation);
}

function compareBubbleReadingOrder(left: BubbleCandidate, right: BubbleCandidate): number {
  return compareBoxes(left.box, right.box, left.orientation, right.orientation);
}

function compareObservations(left: BubbleObservation, right: BubbleObservation): number {
  return compareBoxes(left.box, right.box, left.orientation, right.orientation);
}

function compareBoxes(
  left: Rect,
  right: Rect,
  leftOrientation: BubbleObservation["orientation"],
  rightOrientation: BubbleObservation["orientation"],
): number {
  if (leftOrientation === "vertical" && rightOrientation === "vertical") {
    const sameVerticalBand = Math.abs(left.x - right.x) <= Math.max(left.width, right.width) * 0.5;
    if (sameVerticalBand) return left.y - right.y;
    return right.x - left.x || left.y - right.y;
  }
  const sameHorizontalBand = Math.abs(left.y - right.y) <= Math.max(left.height, right.height) * 0.35;
  if (sameHorizontalBand) return left.x - right.x;
  return left.y - right.y || left.x - right.x;
}

function isHighConfidenceVisualEvidence(
  evidence: BubbleOwnershipEvidence | undefined,
): evidence is BubbleOwnershipEvidence & { visualGroupId: string } {
  return Boolean(
    evidence?.visualGroupId
    && evidence.confidence >= HIGH_CONFIDENCE_VISUAL_GROUP
    && !evidence.touchesBoundary,
  );
}

function groupEvidenceByObservationId(
  ownershipEvidence: readonly BubbleOwnershipEvidence[],
): Map<string, BubbleOwnershipEvidence[]> {
  const grouped = new Map<string, BubbleOwnershipEvidence[]>();
  for (const evidence of ownershipEvidence) {
    const items = grouped.get(evidence.observationId);
    if (items) items.push(evidence);
    else grouped.set(evidence.observationId, [evidence]);
  }
  return grouped;
}

function dedupeObservationEntries(entries: ObservationEntry[]): ObservationEntry[] {
  const clusters: ObservationEntry[][] = [];
  for (const entry of entries) {
    const cluster = clusters.find((items) => (
      items.some((existing) => isDuplicateObservation(existing.observation, entry.observation))
      && items.every((existing) => isDuplicateOwnershipCompatible(existing.evidence, entry.evidence))
    ));
    if (cluster) cluster.push(entry);
    else clusters.push([entry]);
  }
  return clusters.map((cluster) => {
    const representative = [...cluster].sort((left, right) => (
      right.observation.confidence - left.observation.confidence
      || compareReadingOrder(left, right)
      || left.observation.id.localeCompare(right.observation.id)
    ))[0]!;
    const evidence = selectPreferredEvidence(
      cluster.flatMap((entry) => entry.evidence ? [entry.evidence] : []),
      representative.observation.id,
    );
    return {
      observation: representative.observation,
      evidence,
      observationIds: cluster.flatMap((entry) => entry.observationIds).sort(),
    };
  });
}

function isDuplicateObservation(left: BubbleObservation, right: BubbleObservation): boolean {
  return normalizeText(left.sourceText) === normalizeText(right.sourceText)
    && rectIoU(left.box, right.box) > 0.65;
}

function isDuplicateOwnershipCompatible(
  left: BubbleOwnershipEvidence | undefined,
  right: BubbleOwnershipEvidence | undefined,
): boolean {
  if (!isHighConfidenceVisualEvidence(left) || !isHighConfidenceVisualEvidence(right)) return true;
  return left.visualGroupId === right.visualGroupId;
}

function selectPreferredEvidence(
  evidenceItems: readonly BubbleOwnershipEvidence[],
  observationId: string,
): BubbleOwnershipEvidence | undefined {
  const selected = [...evidenceItems].sort((left, right) => (
    evidenceConsistencyScore(right, evidenceItems) - evidenceConsistencyScore(left, evidenceItems)
    || evidenceQualityScore(right) - evidenceQualityScore(left)
  ))[0];
  return selected ? { ...selected, observationId } : undefined;
}

function evidenceConsistencyScore(
  candidate: BubbleOwnershipEvidence,
  evidenceItems: readonly BubbleOwnershipEvidence[],
): number {
  const candidateBox = candidate.componentBox;
  if (!candidateBox) return 0;
  return evidenceItems.filter((other) => (
    other !== candidate
    && other.componentBox !== undefined
    && other.shape === candidate.shape
    && rectIoU(other.componentBox, candidateBox) >= 0.8
  )).length;
}

function evidenceQualityScore(evidence: BubbleOwnershipEvidence): number {
  const manual = evidence.manualGroupId ? 100 : 0;
  const enclosedVisual = isHighConfidenceVisualEvidence(evidence) ? 50 : 0;
  const enclosed = evidence.touchesBoundary ? 0 : 10;
  const component = evidence.componentBox ? 5 : 0;
  return manual + enclosedVisual + enclosed + component + clampConfidence(evidence.confidence);
}

function isUsableObservation(observation: BubbleObservation): boolean {
  return observation.sourceText.trim().length > 0
    && observation.box.width > 1
    && observation.box.height > 1;
}

function unionRect(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlapLength(firstStart: number, firstSize: number, secondStart: number, secondSize: number): number {
  return Math.max(0, Math.min(firstStart + firstSize, secondStart + secondSize) - Math.max(firstStart, secondStart));
}

function gapBetween(firstStart: number, firstSize: number, secondStart: number, secondSize: number): number {
  const firstEnd = firstStart + firstSize;
  const secondEnd = secondStart + secondSize;
  if (firstEnd < secondStart) return secondStart - firstEnd;
  if (secondEnd < firstStart) return firstStart - secondEnd;
  return 0;
}

function centerX(rect: Rect): number {
  return rect.x + rect.width / 2;
}

function rectIoU(left: Rect, right: Rect): number {
  const intersectionWidth = overlapLength(left.x, left.width, right.x, right.width);
  const intersectionHeight = overlapLength(left.y, left.height, right.y, right.height);
  const intersection = intersectionWidth * intersectionHeight;
  if (intersection <= 0) return 0;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, "").toLocaleLowerCase();
}

function createStableBubbleIdentity(
  shape: BubbleShape,
  box: Rect,
  sourceText: string,
  orientation: BubbleCandidate["orientation"],
  kind: BubbleCandidate["kind"],
  visualGroupId: string | undefined,
): string {
  return [
    shape,
    kind,
    orientation,
    visualGroupId ? `visual:${visualGroupId}` : "visual:none",
    quantizedRectKey(box, visualGroupId ? 4 : 1),
    normalizeIdentityText(sourceText),
  ].join("|");
}

function createStableBubbleId(identity: string): string {
  return `bubble-${fnv1a32(identity).toString(16).padStart(8, "0")}`;
}

function quantizedRectKey(box: Rect, quantum: number): string {
  return [
    box.x,
    box.y,
    box.x + box.width,
    box.y + box.height,
  ].map((value) => Math.round(value / quantum)).join(":");
}

function ensureUniqueBubbleIds(identified: IdentifiedBubbleCandidate[]): BubbleCandidate[] {
  const occurrences = new Map<string, number>();
  return identified.map(({ candidate }) => {
    const occurrence = (occurrences.get(candidate.id) ?? 0) + 1;
    occurrences.set(candidate.id, occurrence);
    return occurrence === 1
      ? candidate
      : { ...candidate, id: `${candidate.id}-${occurrence}` };
  });
}

function normalizeIdentityText(text: string): string {
  return text
    .normalize("NFKC")
    .split(/\n+/)
    .map((line) => line.trim().replace(/\s+/g, " ").toLocaleLowerCase())
    .filter(Boolean)
    .join("\n");
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
