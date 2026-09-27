/** Port of recommendation.py @ 92f3493; see docs/recommendations/provenance.md. */
export const ALGORITHM_VERSION = 'nfa100-92f3493-ts-v1';
export const FACTORS = [
  'strength',
  'muscularEndurance',
  'cardiovascularEndurance',
  'flexibility',
  'agility',
  'power',
] as const;
export type Factor = (typeof FACTORS)[number];
export type FactorVector = Record<Factor, number>;
export type FitnessFactor = {
  status: 'graded' | 'below_standard' | 'not_measured' | 'unevaluable';
  grade: number | null;
  need: number | null;
};
export type FitnessInput = Partial<Record<Factor, FitnessFactor>>;
export type RecommendationVideo = {
  videoId: string;
  title: string;
  originalUrl: string;
  ageGroup: string;
  equipment: string[];
  fitnessWeights: FactorVector;
  durationSeconds: number;
};
export type WorkoutLog = {
  videoId: string;
  date: string;
  completed: boolean;
  fitnessWeights?: FactorVector;
};
export type ScoredVideo = { video: RecommendationVideo; score: number };
export const WEIGHT_SUM_TOLERANCE = 1e-9;
// NumPy isclose(a, max): abs(a-max) <= atol + rtol * abs(max).
export const TIE_RTOL = 1e-5;
export const TIE_ATOL = 1e-8;
const DAY_MS = 86_400_000;
export const vector = (value = 0): FactorVector =>
  Object.fromEntries(FACTORS.map((f) => [f, value])) as FactorVector;

export function validateWeights(value: unknown, videoId: string): FactorVector {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${videoId}: fitnessWeights must be an object`);
  const weights = value as Record<string, unknown>;
  let sum = 0;
  for (const factor of FACTORS) {
    const weight = weights[factor];
    if (typeof weight !== 'number' || !Number.isFinite(weight))
      throw new Error(`${videoId}: ${factor} must be finite`);
    if (weight < 0 || weight > 1)
      throw new Error(`${videoId}: ${factor} must be in [0, 1]`);
    sum += weight;
  }
  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE)
    throw new Error(
      `${videoId}: weight sum ${sum} must equal 1 (absolute tolerance ${WEIGHT_SUM_TOLERANCE})`,
    );
  return { ...weights } as FactorVector;
}

/** Strict date-only values stay dates; zoned instants are normalized to Korea. */
export function kstDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw new Error('Invalid calendar date');
    return value;
  }
  if (
    typeof value === 'string' &&
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    throw new Error('Timestamp must specify a timezone');
  if (typeof value === 'string') kstDate(value.slice(0, 10));
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid date');
  return new Date(instant.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
const dayNumber = (date: string) =>
  Date.parse(`${kstDate(date)}T00:00:00Z`) / DAY_MS;
export const nextDate = (date: string) =>
  new Date((dayNumber(date) + 1) * DAY_MS).toISOString().slice(0, 10);

/** Remove future logs once at entry, but retain ALL older history for tie-breaking. */
export function eligibleLogs(
  logs: readonly WorkoutLog[] | null,
  referenceDate: string,
): WorkoutLog[] {
  const day = kstDate(referenceDate);
  // Date-only callers use the source algorithm's calendar-day contract. API
  // callers retain the server instant as well, so later timestamps on the same
  // KST date are excluded before date normalization and every calculation.
  const referenceInstant = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
    ? null
    : Date.parse(referenceDate);
  if (logs === null) return [];
  if (!Array.isArray(logs)) throw new Error('logs must be an array');
  return logs.flatMap((log, index) => {
    if (
      !log ||
      typeof log.videoId !== 'string' ||
      !log.videoId.trim() ||
      typeof log.completed !== 'boolean' ||
      typeof log.date !== 'string'
    )
      throw new Error(`logs[${index}]: invalid videoId/date/completed`);
    const date = kstDate(log.date);
    if (log.fitnessWeights) validateWeights(log.fitnessWeights, log.videoId);
    const futureInstant =
      referenceInstant !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(log.date) &&
      Date.parse(log.date) > referenceInstant;
    return date <= day && !futureInstant ? [{ ...log, date }] : [];
  });
}
export function getFitnessNeed(grade: unknown): number | null {
  if (typeof grade !== 'number' || !Number.isFinite(grade)) return null;
  return grade === 1 ? 0.25 : grade === 2 ? 0.5 : grade >= 3 ? 1 : null;
}
export function calculateRecentExposure(
  videos: readonly RecommendationVideo[],
  logs: readonly WorkoutLog[] | null,
  referenceDate: string,
): FactorVector {
  const exposure = vector();
  const index = new Map(videos.map((v) => [v.videoId, v]));
  for (const log of eligibleLogs(logs, referenceDate)) {
    const daysAgo = dayNumber(referenceDate) - dayNumber(log.date);
    if (daysAgo < 1 || daysAgo > 14) continue;
    const weights =
      log.fitnessWeights ?? index.get(log.videoId)?.fitnessWeights;
    if (!weights) continue;
    for (const factor of FACTORS)
      exposure[factor] +=
        weights[factor] * 0.5 ** (daysAgo / 7) * (log.completed ? 1 : 0.5);
  }
  for (const factor of FACTORS)
    exposure[factor] = Math.min(0.3 * exposure[factor], 1);
  return exposure;
}
export function calculatePriority(
  fitness: FitnessInput,
  exposure: FactorVector,
): FactorVector {
  const priority = vector();
  for (const factor of FACTORS) {
    const state = fitness[factor];
    const need =
      state?.status === 'below_standard'
        ? 1
        : state?.status === 'graded'
          ? getFitnessNeed(state.grade)
          : null;
    const unexposed = 1 - Math.min(Math.max(exposure[factor] ?? 0, 0), 1);
    priority[factor] = need === null ? 1.5 * unexposed : need + unexposed;
  }
  return priority;
}
export function filterByAge(
  videos: readonly RecommendationVideo[],
  age: number,
): RecommendationVideo[] {
  if (!Number.isInteger(age) || age < 13 || age > 64)
    throw new Error('unsupported_age: current product supports ages 13–64');
  const groups = age < 19 ? ['공통', '청소년'] : ['공통', '성인'];
  return videos.filter((v) => groups.includes(v.ageGroup));
}
export function excludeRecentVideos(
  videos: readonly RecommendationVideo[],
  logs: readonly WorkoutLog[] | null,
  referenceDate: string,
): RecommendationVideo[] {
  const recent = new Set(
    eligibleLogs(logs, referenceDate)
      .filter((log) => {
        const days = dayNumber(referenceDate) - dayNumber(log.date);
        return days >= 1 && days <= 7;
      })
      .map((log) => log.videoId),
  );
  return videos.filter((v) => !recent.has(v.videoId));
}
export function calculateVideoScores(
  videos: readonly RecommendationVideo[],
  priority: FactorVector,
): ScoredVideo[] {
  return videos.map((video) => ({
    video,
    score: FACTORS.reduce(
      (score, f) => score + video.fitnessWeights[f] * priority[f],
      0,
    ),
  }));
}
export function tiedCandidates(
  scored: readonly ScoredVideo[],
  logs: readonly WorkoutLog[] | null,
  referenceDate: string,
): ScoredVideo[] {
  if (!scored.length) throw new Error('No eligible workout videos');
  const max = Math.max(...scored.map((v) => v.score));
  const best = scored.filter(
    (v) => Math.abs(v.score - max) <= TIE_ATOL + TIE_RTOL * Math.abs(max),
  );
  const latest = new Map<string, string>();
  for (const log of eligibleLogs(logs, referenceDate))
    if (!latest.has(log.videoId) || log.date > latest.get(log.videoId)!)
      latest.set(log.videoId, log.date);
  const never = best.filter((v) => !latest.has(v.video.videoId));
  if (never.length) return never;
  const oldest = best.map((v) => latest.get(v.video.videoId)!).sort()[0];
  return best.filter((v) => latest.get(v.video.videoId) === oldest);
}
export function selectBestVideo(
  scored: readonly ScoredVideo[],
  logs: readonly WorkoutLog[] | null,
  referenceDate: string,
  rng: () => number = Math.random,
): RecommendationVideo {
  const candidates = tiedCandidates(scored, logs, referenceDate);
  const random = rng();
  if (!Number.isFinite(random) || random < 0 || random >= 1)
    throw new Error('RNG must return a finite value in [0, 1)');
  return candidates[Math.floor(random * candidates.length)].video;
}
export function recommendNextWorkout(input: {
  age: number;
  fitness: FitnessInput;
  logs: readonly WorkoutLog[] | null;
  referenceDate: string;
  videos: readonly RecommendationVideo[];
  rng?: () => number;
}) {
  const logs = eligibleLogs(input.logs, input.referenceDate);
  const exposure = calculateRecentExposure(
    input.videos,
    logs,
    input.referenceDate,
  );
  const priority = calculatePriority(input.fitness, exposure);
  const ageCandidates = filterByAge(input.videos, input.age);
  const recentExcluded = excludeRecentVideos(
    ageCandidates,
    logs,
    input.referenceDate,
  );
  const candidates = recentExcluded.length ? recentExcluded : ageCandidates;
  const scored = calculateVideoScores(candidates, priority);
  const selected = selectBestVideo(
    scored,
    logs,
    input.referenceDate,
    input.rng,
  );
  return {
    videoId: selected.videoId,
    exposure,
    priority,
    candidateIds: candidates.map((v) => v.videoId),
    tiedCandidateIds: tiedCandidates(scored, logs, input.referenceDate).map(
      (v) => v.video.videoId,
    ),
  };
}
export type WeightAdjustment = Record<
  Factor,
  { previous: number; delta: number; next: number }
>;
/** Internal exposure only. Recompute from final per-assignment results, never add persisted deltas. */
export function calculateWeightAdjustment(
  videos: readonly RecommendationVideo[],
  logs: readonly WorkoutLog[] | null,
  referenceDate: string,
): WeightAdjustment {
  const previous = calculateRecentExposure(videos, logs, referenceDate);
  const next = { ...previous };
  const index = new Map(videos.map((v) => [v.videoId, v]));
  for (const log of eligibleLogs(logs, referenceDate)) {
    if (log.date !== kstDate(referenceDate)) continue;
    const weights =
      log.fitnessWeights ?? index.get(log.videoId)?.fitnessWeights;
    if (!weights) continue;
    for (const factor of FACTORS)
      next[factor] += 0.3 * weights[factor] * (log.completed ? 1 : 0.5);
  }
  return Object.fromEntries(
    FACTORS.map((f) => {
      const capped = Math.min(next[f], 1);
      return [
        f,
        { previous: previous[f], delta: capped - previous[f], next: capped },
      ];
    }),
  ) as WeightAdjustment;
}
export function roundWeightAdjustment(
  adjustment: WeightAdjustment,
): WeightAdjustment {
  return Object.fromEntries(
    FACTORS.map((f) => [
      f,
      Object.fromEntries(
        Object.entries(adjustment[f]).map(([key, value]) => [
          key,
          Number(value.toFixed(3)),
        ]),
      ),
    ]),
  ) as WeightAdjustment;
}
