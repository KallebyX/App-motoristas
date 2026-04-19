import { describe, expect, it } from 'vitest';
import {
  coefficientOfVariation,
  mean,
  median,
  stdDev,
  zScore,
  zToScore,
} from './stats.js';

describe('stats helpers', () => {
  it('computes median for odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('throws on empty input for median/mean', () => {
    expect(() => median([])).toThrow();
    expect(() => mean([])).toThrow();
  });

  it('computes mean and sd', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(stdDev([1, 2, 3, 4, 5])).toBeCloseTo(1.5811, 3);
  });

  it('returns 0 sd for single-value input', () => {
    expect(stdDev([42])).toBe(0);
  });

  it('computes coefficient of variation and handles zero mean', () => {
    expect(coefficientOfVariation([100, 110, 120])).toBeCloseTo(stdDev([100, 110, 120]) / 110, 5);
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });

  it('z-score correctly normalizes a value', () => {
    expect(zScore(280, { mean: 280, sd: 45 })).toBe(0);
    expect(zScore(325, { mean: 280, sd: 45 })).toBe(1);
    expect(zScore(280, { mean: 280, sd: 0 })).toBe(0);
  });

  it('zToScore clamps into 0..100', () => {
    expect(zToScore(0)).toBe(50);
    expect(zToScore(2)).toBe(100);
    expect(zToScore(-2)).toBe(0);
    expect(zToScore(10)).toBe(100);
    expect(zToScore(-10)).toBe(0);
  });
});
