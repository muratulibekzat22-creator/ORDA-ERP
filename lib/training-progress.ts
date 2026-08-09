export type WatchedRange = [number, number];

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function parseWatchedRanges(value: unknown): WatchedRange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      !finite(item[0]) ||
      !finite(item[1]) ||
      item[1] <= item[0]
    )
      return [];
    return [[item[0], item[1]] as WatchedRange];
  });
}

export function mergeWatchedRanges(
  ranges: WatchedRange[],
  duration: number,
): WatchedRange[] {
  const bounded = ranges
    .map(([start, end]) => [
      Math.max(0, Math.min(duration, start)),
      Math.max(0, Math.min(duration, end)),
    ] as WatchedRange)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: WatchedRange[] = [];
  for (const range of bounded) {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1] + 0.5) merged.push([...range]);
    else previous[1] = Math.max(previous[1], range[1]);
  }
  return merged;
}

export function watchedPercent(ranges: WatchedRange[], duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const seconds = mergeWatchedRanges(ranges, duration).reduce(
    (sum, [start, end]) => sum + end - start,
    0,
  );
  return Math.min(100, (seconds / duration) * 100);
}

export function acceptedHeartbeatRange(input: {
  previousTime: number | null;
  previousAt: Date | null;
  currentTime: number;
  receivedAt: Date;
  playerState: string;
}): WatchedRange | null {
  if (
    input.playerState !== "PLAYING" ||
    input.previousTime === null ||
    input.previousAt === null
  )
    return null;
  const wallSeconds =
    (input.receivedAt.getTime() - input.previousAt.getTime()) / 1000;
  const mediaSeconds = input.currentTime - input.previousTime;
  if (
    wallSeconds <= 0 ||
    wallSeconds > 20 ||
    mediaSeconds < 0.25 ||
    mediaSeconds > Math.min(12, wallSeconds + 2.5)
  )
    return null;
  return [input.previousTime, input.currentTime];
}
