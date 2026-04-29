// Deno-native copy of packages/scoring + packages/shared-types.
// Kept in sync with the source packages — if you change scoring logic,
// update this file too. CI could automate with a copy script later.
// See docs/scoring-methodology.md for the why.

import { z } from 'https://esm.sh/zod@3.23.8';

// ---------- Shared types (mirrored from packages/shared-types) ----------

export const TrafficLight = z.enum(['green', 'yellow', 'red']);
export type TrafficLight = z.infer<typeof TrafficLight>;

export const TestBlock = z.enum(['pvt_b', 'divided_attention', 'vigilance']);
export type TestBlock = z.infer<typeof TestBlock>;

export const TrialSchema = z.object({
  stimulusAtMs: z.number().nonnegative(),
  responseAtMs: z.number().nonnegative().nullable(),
  rtMs: z.number().nonnegative().nullable(),
  isLapse: z.boolean(),
  isFalseStart: z.boolean(),
});
export type Trial = z.infer<typeof TrialSchema>;

export const BlockResultSchema = z.object({
  block: TestBlock,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  trials: z.array(TrialSchema).min(1),
});
export type BlockResult = z.infer<typeof BlockResultSchema>;

export const SubjectiveAnswersSchema = z.object({
  kss: z.number().int().min(1).max(9),
  samnPerelli: z.number().int().min(1).max(7),
  hoursSlept: z.number().min(0).max(24).optional(),
});
export type SubjectiveAnswers = z.infer<typeof SubjectiveAnswersSchema>;

export const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().optional(),
});

export const SessionSubmissionSchema = z.object({
  sessionId: z.string().uuid(),
  driverId: z.string().uuid(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  deviceFingerprint: z.string().min(8),
  appVersion: z.string(),
  geo: GeoPointSchema.nullable(),
  livenessVideoRef: z.string().nullable(),
  livenessMatchScore: z.number().min(0).max(100).nullable(),
  blocks: z.array(BlockResultSchema).min(1),
  subjective: SubjectiveAnswersSchema,
});
export type SessionSubmission = z.infer<typeof SessionSubmissionSchema>;

export const BlockPolicySchema = z.object({
  yellow: z.enum(['warn', 'block']).default('warn'),
  red: z.enum(['warn', 'block']).default('block'),
});
export type BlockPolicy = z.infer<typeof BlockPolicySchema>;

export interface SessionScore {
  sessionId: string;
  objectiveScore: number;
  subjectiveScore: number;
  finalScore: number;
  trafficLight: TrafficLight;
  blocked: boolean;
  algorithmVersion: string;
}

// ---------- Norms (mirrored from packages/scoring/src/norms.ts) ----------

export const PVT_B_NORMS = {
  medianRtMs: { mean: 280, sd: 45 },
  lapseRate: { mean: 0.05, sd: 0.04 },
  cvRt: { mean: 0.18, sd: 0.05 },
} as const;

export const TRAFFIC_LIGHT_CUTOFFS = { greenMin: 75, yellowMin: 55 } as const;
export const HARD_RED_RULES = {
  lapseRateThreshold: 0.2,
  kssThreshold: 8,
  samnPerelliThreshold: 6,
} as const;
export const SCORE_WEIGHTS = { objective: 0.6, subjective: 0.4 } as const;
export const ALGORITHM_VERSION = 'v1';

// ---------- Stats helpers ----------

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median requires >=1 value');
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean requires >=1 value');
  return values.reduce((a, b) => a + b, 0) / values.length;
}
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  return m === 0 ? 0 : stdDev(values) / m;
}
export function zScore(value: number, norm: { mean: number; sd: number }): number {
  return norm.sd === 0 ? 0 : (value - norm.mean) / norm.sd;
}
export function zToScore(z: number): number {
  return Math.max(0, Math.min(100, 50 + z * 25));
}

// ---------- Scorer ----------

export interface BlockMetrics {
  medianRtMs: number;
  lapseRate: number;
  cvRt: number;
  falseStartRate: number;
  zScore: number;
}

export interface ScoringOutput extends SessionScore {
  blockMetrics: Record<string, BlockMetrics>;
  hardRedReasons: string[];
}

export function computeBlockMetrics(block: BlockResult): BlockMetrics {
  const valid = block.trials.filter((t) => !t.isFalseStart && t.rtMs != null);
  const rts = valid.map((t) => t.rtMs as number);
  const falseStarts = block.trials.filter((t) => t.isFalseStart).length;
  const falseStartRate = block.trials.length > 0 ? falseStarts / block.trials.length : 0;
  // Match scorer.ts: penalize blocks with no valid trials (all missed/false-start).
  if (valid.length === 0) {
    return {
      medianRtMs: PVT_B_NORMS.medianRtMs.mean + 4 * PVT_B_NORMS.medianRtMs.sd,
      lapseRate: 1,
      cvRt: PVT_B_NORMS.cvRt.mean + 4 * PVT_B_NORMS.cvRt.sd,
      falseStartRate,
      zScore: -4,
    };
  }
  const med = median(rts);
  const lapses = valid.filter((t) => t.isLapse).length;
  const lapseRate = lapses / valid.length;
  const cv = rts.length > 1 ? coefficientOfVariation(rts) : 0;
  const zs = [
    -zScore(med, PVT_B_NORMS.medianRtMs),
    -zScore(lapseRate, PVT_B_NORMS.lapseRate),
    -zScore(cv, PVT_B_NORMS.cvRt),
  ];
  return { medianRtMs: med, lapseRate, cvRt: cv, falseStartRate, zScore: zs.reduce((a, b) => a + b, 0) / zs.length };
}

export function computeObjectiveScore(blocks: BlockResult[]) {
  if (blocks.length === 0) return { score: 0, metrics: {} as Record<string, BlockMetrics> };
  const metrics: Record<string, BlockMetrics> = {};
  let zSum = 0;
  for (const b of blocks) {
    const m = computeBlockMetrics(b);
    metrics[b.block] = m;
    zSum += m.zScore;
  }
  return { score: zToScore(zSum / blocks.length), metrics };
}

export function computeSubjectiveScore(a: SubjectiveAnswers): number {
  const kssNorm = 1 - (a.kss - 1) / 8;
  const spNorm = 1 - (a.samnPerelli - 1) / 6;
  return Math.max(0, Math.min(100, ((kssNorm + spNorm) / 2) * 100));
}

export function classifyTrafficLight(finalScore: number, hardRed: boolean): TrafficLight {
  if (hardRed) return 'red';
  if (finalScore >= TRAFFIC_LIGHT_CUTOFFS.greenMin) return 'green';
  if (finalScore >= TRAFFIC_LIGHT_CUTOFFS.yellowMin) return 'yellow';
  return 'red';
}

export function evaluateHardRed(
  metrics: Record<string, BlockMetrics>,
  s: SubjectiveAnswers,
): string[] {
  const reasons: string[] = [];
  for (const [name, m] of Object.entries(metrics)) {
    if (m.lapseRate > HARD_RED_RULES.lapseRateThreshold) {
      reasons.push(`lapse_rate_exceeded:${name}:${m.lapseRate.toFixed(3)}`);
    }
  }
  if (s.kss >= HARD_RED_RULES.kssThreshold) reasons.push(`kss_critical:${s.kss}`);
  if (s.samnPerelli >= HARD_RED_RULES.samnPerelliThreshold) reasons.push(`samn_perelli_critical:${s.samnPerelli}`);
  return reasons;
}

export function scoreSession(input: {
  submission: SessionSubmission;
  policy: BlockPolicy;
}): ScoringOutput {
  const { submission, policy } = input;
  const { score: objectiveScore, metrics } = computeObjectiveScore(submission.blocks);
  const subjectiveScore = computeSubjectiveScore(submission.subjective);
  const finalScore =
    objectiveScore * SCORE_WEIGHTS.objective + subjectiveScore * SCORE_WEIGHTS.subjective;
  const hardRedReasons = evaluateHardRed(metrics, submission.subjective);
  const trafficLight = classifyTrafficLight(finalScore, hardRedReasons.length > 0);
  const blocked =
    (trafficLight === 'red' && policy.red === 'block') ||
    (trafficLight === 'yellow' && policy.yellow === 'block');
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sessionId: submission.sessionId,
    objectiveScore: round2(objectiveScore),
    subjectiveScore: round2(subjectiveScore),
    finalScore: round2(finalScore),
    trafficLight,
    blocked,
    algorithmVersion: ALGORITHM_VERSION,
    blockMetrics: metrics,
    hardRedReasons,
  };
}
