import type {
  BlockResult,
  SessionScore,
  SessionSubmission,
  SubjectiveAnswers,
  TrafficLight,
  Trial,
} from '@app-motoristas/shared-types';
import {
  ALGORITHM_VERSION,
  HARD_RED_RULES,
  PVT_B_NORMS,
  SCORE_WEIGHTS,
  TRAFFIC_LIGHT_CUTOFFS,
} from './norms.js';
import { coefficientOfVariation, median, zScore, zToScore } from './stats.js';

export interface BlockMetrics {
  medianRtMs: number;
  lapseRate: number;
  cvRt: number;
  falseStartRate: number;
  zScore: number;
}

export interface ScoringInput {
  submission: SessionSubmission;
  policy: { yellow: 'warn' | 'block'; red: 'warn' | 'block' };
}

export interface ScoringOutput extends SessionScore {
  blockMetrics: Record<string, BlockMetrics>;
  hardRedReasons: string[];
}

export function computeBlockMetrics(block: BlockResult): BlockMetrics {
  const validTrials: Trial[] = block.trials.filter((t) => !t.isFalseStart && t.rtMs != null);
  const rts = validTrials.map((t) => t.rtMs as number);
  const falseStarts = block.trials.filter((t) => t.isFalseStart).length;

  const med = rts.length > 0 ? median(rts) : 0;
  const lapses = validTrials.filter((t) => t.isLapse).length;
  const lapseRate = validTrials.length > 0 ? lapses / validTrials.length : 0;
  const cv = rts.length > 1 ? coefficientOfVariation(rts) : 0;
  const falseStartRate = block.trials.length > 0 ? falseStarts / block.trials.length : 0;

  // Compose a single Z for the block: average across RT, lapses and CV (higher = worse).
  // Negate so that LOWER RT/lapse → positive Z (better performance).
  const zs = [
    -zScore(med, PVT_B_NORMS.medianRtMs),
    -zScore(lapseRate, PVT_B_NORMS.lapseRate),
    -zScore(cv, PVT_B_NORMS.cvRt),
  ];
  const avgZ = zs.reduce((s, v) => s + v, 0) / zs.length;

  return {
    medianRtMs: med,
    lapseRate,
    cvRt: cv,
    falseStartRate,
    zScore: avgZ,
  };
}

export function computeObjectiveScore(blocks: BlockResult[]): {
  score: number;
  metrics: Record<string, BlockMetrics>;
} {
  if (blocks.length === 0) {
    return { score: 0, metrics: {} };
  }
  const metrics: Record<string, BlockMetrics> = {};
  let zSum = 0;
  for (const block of blocks) {
    const m = computeBlockMetrics(block);
    metrics[block.block] = m;
    zSum += m.zScore;
  }
  const avgZ = zSum / blocks.length;
  return { score: zToScore(avgZ), metrics };
}

export function computeSubjectiveScore(answers: SubjectiveAnswers): number {
  // KSS: 1 (alert) → 9 (very sleepy).  Samn-Perelli: 1 (fully alert) → 7 (exhausted).
  // Normalize each to 0..1 (where 0 = worst) and average.
  const kssNorm = 1 - (answers.kss - 1) / 8;
  const spNorm = 1 - (answers.samnPerelli - 1) / 6;
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
  subjective: SubjectiveAnswers,
): string[] {
  const reasons: string[] = [];
  for (const [block, m] of Object.entries(metrics)) {
    if (m.lapseRate > HARD_RED_RULES.lapseRateThreshold) {
      reasons.push(`lapse_rate_exceeded:${block}:${m.lapseRate.toFixed(3)}`);
    }
  }
  if (subjective.kss >= HARD_RED_RULES.kssThreshold) {
    reasons.push(`kss_critical:${subjective.kss}`);
  }
  if (subjective.samnPerelli >= HARD_RED_RULES.samnPerelliThreshold) {
    reasons.push(`samn_perelli_critical:${subjective.samnPerelli}`);
  }
  return reasons;
}

export function scoreSession(input: ScoringInput): ScoringOutput {
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
