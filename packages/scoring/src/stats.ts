export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median() requires at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean() requires at least one value');
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / m;
}

export function zScore(value: number, norm: { mean: number; sd: number }): number {
  if (norm.sd === 0) return 0;
  return (value - norm.mean) / norm.sd;
}

// Clamp a Z-score into a [0, 100] scale where Z=0 → 50, Z=-2 → 0, Z=+2 → 100.
// For PVT, higher RT / lapses are WORSE, so the caller negates the Z before passing.
export function zToScore(z: number): number {
  const scaled = 50 + z * 25;
  return Math.max(0, Math.min(100, scaled));
}
