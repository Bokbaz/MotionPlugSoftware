export interface TimeRange {
  start: number;
  end: number;
  id?: string;
}

export interface TrackSnapshot {
  index: number;
  ranges: TimeRange[];
  locked?: boolean;
}

export interface TrackPolicy {
  mode: "auto" | "specific";
  index: number;
}

export interface DestinationPlan {
  index: number;
  createsTrack: boolean;
  lockStateKnown: boolean;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end - 1e-7 && a.end > b.start + 1e-7;
}

export function isRangeFree(track: TrackSnapshot, wanted: TimeRange, ignoreIds: string[] = []): boolean {
  const ignored = new Set(ignoreIds);
  return track.ranges.every((range) => ignored.has(range.id ?? "") || !overlaps(range, wanted));
}

export function planDestination(
  tracks: TrackSnapshot[],
  wanted: TimeRange,
  policy: TrackPolicy,
  ignoreIds: string[] = [],
): DestinationPlan {
  const ordered = [...tracks].sort((a, b) => b.index - a.index);
  if (policy.mode === "specific") {
    const track = tracks.find((item) => item.index === policy.index);
    if (!track) {
      if (policy.index === tracks.length) {
        return { index: policy.index, createsTrack: true, lockStateKnown: true };
      }
      throw new Error(`Video track V${policy.index + 1} does not exist.`);
    }
    if (track.locked === true) throw new Error(`Video track V${policy.index + 1} is locked.`);
    if (!isRangeFree(track, wanted, ignoreIds)) {
      throw new Error(`Video track V${policy.index + 1} is occupied at the playhead.`);
    }
    return { index: track.index, createsTrack: false, lockStateKnown: track.locked !== undefined };
  }

  const candidate = ordered.find(
    (track) => track.locked !== true && isRangeFree(track, wanted, ignoreIds),
  );
  if (candidate) {
    return {
      index: candidate.index,
      createsTrack: false,
      lockStateKnown: candidate.locked !== undefined,
    };
  }
  const nextIndex = tracks.length ? Math.max(...tracks.map((track) => track.index)) + 1 : 0;
  return { index: nextIndex, createsTrack: true, lockStateKnown: true };
}

export function candidateIndexes(plan: DestinationPlan, trackCount: number, policy: TrackPolicy): number[] {
  if (policy.mode === "specific") return [plan.index];
  const result = [plan.index];
  if (plan.index < trackCount) result.push(trackCount);
  return result;
}
