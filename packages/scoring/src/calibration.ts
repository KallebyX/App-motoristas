// Recalibration helpers for the shadow pilot (see issue #5).
//
// During the shadow phase, the app runs with block_policy = warn/warn so no
// driver is ever blocked. After ~30 days of data we take the population of
// sessions and recompute the PVT-B norms + propose new traffic-light cutoffs
// that hit a target false-positive rate. This module provides those
// calculations as pure functions so we can unit-test them; the analyst
// pipes real sessions in and gets actionable numbers out.

import type {
  BlockResult,
  SessionSubmission,
  Trial,
} from '@app-motoristas/shared-types';
import { computeBlockMetrics, type BlockMetrics } from './scorer.js';
import {
  HARD_RED_RULES,
  PVT_B_NORMS,
  SCORE_WEIGHTS,
  TRAFFIC_LIGHT_CUTOFFS,
} from './norms.js';
import { mean, stdDev, zToScore } from './stats.js';

export interface BaselineProposal {
  sampleSize: number;
  medianRtMs: { mean: number; sd: number };
  lapseRate: { mean: number; sd: number };
  cvRt: { mean: number; sd: number };
  // Distribution percentiles — useful to spot-check sanity before shipping.
  percentiles: {
    medianRtMs: { p25: number; p50: number; p75: number; p95: number };
    lapseRate: { p25: number; p50: number; p75: number; p95: number };
  };
}

/**
 * Compute recommended PVT_B_NORMS values from a population of PVT-B block
 * results (typically the first block of each first-of-shift session).
 */
export function computeBaseline(blocks: readonly BlockResult[]): BaselineProposal {
  if (blocks.length === 0) throw new Error('computeBaseline needs at least one block');
  const metrics = blocks.map(computeBlockMetrics);
  const medians = metrics.map((m) => m.medianRtMs);
  const lapses = metrics.map((m) => m.lapseRate);
  const cvs = metrics.map((m) => m.cvRt);
  return {
    sampleSize: blocks.length,
    medianRtMs: { mean: round(mean(medians)), sd: round(stdDev(medians)) },
    lapseRate: { mean: round(lapses.reduce((a, b) => a + b, 0) / lapses.length, 4), sd: round(stdDev(lapses), 4) },
    cvRt: { mean: round(mean(cvs), 4), sd: round(stdDev(cvs), 4) },
    percentiles: {
      medianRtMs: {
        p25: percentile(medians, 0.25),
        p50: percentile(medians, 0.5),
        p75: percentile(medians, 0.75),
        p95: percentile(medians, 0.95),
      },
      lapseRate: {
        p25: round(percentile(lapses, 0.25), 4),
        p50: round(percentile(lapses, 0.5), 4),
        p75: round(percentile(lapses, 0.75), 4),
        p95: round(percentile(lapses, 0.95), 4),
      },
    },
  };
}

/**
 * Given a baseline + cutoffs, simulate which traffic light each session
 * *would* receive. Used to tune cutoffs against target false-positive rate.
 */
export interface SimulatedSession {
  sessionId: string;
  observedFinalScore: number;
  trafficLight: 'green' | 'yellow' | 'red';
  hardRed: boolean;
}

export interface Cutoffs {
  greenMin: number;
  yellowMin: number;
}

export function simulateSessions(
  submissions: readonly SessionSubmission[],
  norms: typeof PVT_B_NORMS = PVT_B_NORMS,
  cutoffs: Cutoffs = TRAFFIC_LIGHT_CUTOFFS,
): SimulatedSession[] {
  return submissions.map((s) => {
    const metrics: Record<string, BlockMetrics> = {};
    let zSum = 0;
    for (const block of s.blocks) {
      const m = computeBlockMetricsAgainstNorms(block, norms);
      metrics[block.block] = m;
      zSum += m.zScore;
    }
    const objectiveScore = zToScore(zSum / s.blocks.length);
    const kssNorm = 1 - (s.subjective.kss - 1) / 8;
    const spNorm = 1 - (s.subjective.samnPerelli - 1) / 6;
    const subjectiveScore = ((kssNorm + spNorm) / 2) * 100;
    const finalScore =
      objectiveScore * SCORE_WEIGHTS.objective + subjectiveScore * SCORE_WEIGHTS.subjective;
    const hardRed =
      Object.values(metrics).some((m) => m.lapseRate > HARD_RED_RULES.lapseRateThreshold) ||
      s.subjective.kss >= HARD_RED_RULES.kssThreshold ||
      s.subjective.samnPerelli >= HARD_RED_RULES.samnPerelliThreshold;
    let light: 'green' | 'yellow' | 'red' = 'red';
    if (hardRed) light = 'red';
    else if (finalScore >= cutoffs.greenMin) light = 'green';
    else if (finalScore >= cutoffs.yellowMin) light = 'yellow';
    return {
      sessionId: s.sessionId,
      observedFinalScore: round(finalScore),
      trafficLight: light,
      hardRed,
    };
  });
}

function computeBlockMetricsAgainstNorms(
  block: BlockResult,
  norms: typeof PVT_B_NORMS,
): BlockMetrics {
  const valid: Trial[] = block.trials.filter((t) => !t.isFalseStart && t.rtMs != null);
  const rts = valid.map((t) => t.rtMs as number);
  const falseStarts = block.trials.filter((t) => t.isFalseStart).length;
  const sortedRts = [...rts].sort((a, b) => a - b);
  const med = sortedRts.length
    ? sortedRts.length % 2 === 0
      ? (sortedRts[sortedRts.length / 2 - 1]! + sortedRts[sortedRts.length / 2]!) / 2
      : sortedRts[Math.floor(sortedRts.length / 2)]!
    : 0;
  const lapses = valid.filter((t) => t.isLapse).length;
  const lapseRate = valid.length > 0 ? lapses / valid.length : 0;
  const m = rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : 0;
  const cv =
    rts.length > 1 && m !== 0
      ? Math.sqrt(rts.reduce((s, v) => s + (v - m) ** 2, 0) / (rts.length - 1)) / m
      : 0;
  const falseStartRate = block.trials.length > 0 ? falseStarts / block.trials.length : 0;
  const zs = [
    -((med - norms.medianRtMs.mean) / (norms.medianRtMs.sd || 1)),
    -((lapseRate - norms.lapseRate.mean) / (norms.lapseRate.sd || 1)),
    -((cv - norms.cvRt.mean) / (norms.cvRt.sd || 1)),
  ];
  return {
    medianRtMs: med,
    lapseRate,
    cvRt: cv,
    falseStartRate,
    zScore: zs.reduce((a, b) => a + b, 0) / zs.length,
  };
}

/**
 * Search for (greenMin, yellowMin) that hit a target false-positive rate
 * (fraction of sessions marked red out of all sessions, excluding hard-red).
 * Useful output: the recommended cutoff pair + measured rates.
 */
export interface CalibrationResult {
  greenMin: number;
  yellowMin: number;
  targetRedRate: number;
  measuredRedRate: number;
  measuredYellowRate: number;
  measuredGreenRate: number;
  hardRedRate: number;
}

export function calibrateCutoffs(
  submissions: readonly SessionSubmission[],
  options: { targetRedRate?: number; norms?: typeof PVT_B_NORMS } = {},
): CalibrationResult {
  const target = options.targetRedRate ?? 0.05;
  const norms = options.norms ?? PVT_B_NORMS;
  // Coarse search: try greenMin in [60..90], yellowMin in [40..80] with step 5,
  // pick the combo whose measured red-rate (excluding hard-red) is closest to
  // target but not above it.
  let best: CalibrationResult = {
    greenMin: TRAFFIC_LIGHT_CUTOFFS.greenMin,
    yellowMin: TRAFFIC_LIGHT_CUTOFFS.yellowMin,
    targetRedRate: target,
    measuredRedRate: 1,
    measuredYellowRate: 0,
    measuredGreenRate: 0,
    hardRedRate: 0,
  };
  for (let g = 60; g <= 90; g += 5) {
    for (let y = 40; y < g; y += 5) {
      const sim = simulateSessions(submissions, norms, { greenMin: g, yellowMin: y });
      const total = sim.length || 1;
      const hardRed = sim.filter((s) => s.hardRed).length;
      const red = sim.filter((s) => s.trafficLight === 'red').length;
      const nonHardRed = red - hardRed; // soft reds only
      const rate = nonHardRed / total;
      if (Math.abs(rate - target) < Math.abs(best.measuredRedRate - target)) {
        best = {
          greenMin: g,
          yellowMin: y,
          targetRedRate: target,
          measuredRedRate: round(rate, 4),
          measuredYellowRate: round(sim.filter((s) => s.trafficLight === 'yellow').length / total, 4),
          measuredGreenRate: round(sim.filter((s) => s.trafficLight === 'green').length / total, 4),
          hardRedRate: round(hardRed / total, 4),
        };
      }
    }
  }
  return best;
}

// --- helpers ---

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return round(sorted[idx]!);
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
