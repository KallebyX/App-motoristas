#!/usr/bin/env -S node --experimental-strip-types
// Analyze a pilot dataset and output baseline + proposed cutoffs.
//
// Usage:
//   pnpm dlx supabase db dump ...  # or any pipeline that produces NDJSON
//   node --experimental-strip-types scripts/analyze-pilot.ts sessions.ndjson
//
// Each line of the input file is a SessionSubmission JSON (as persisted by
// the compute-session-score edge function's raw_data join).

import fs from 'node:fs';
import path from 'node:path';
import { calibrateCutoffs, computeBaseline } from '@app-motoristas/scoring';
import type { BlockResult, SessionSubmission } from '@app-motoristas/shared-types';

const file = process.argv[2];
if (!file) {
  console.error('usage: analyze-pilot.ts <sessions.ndjson>');
  process.exit(2);
}
const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error(`file not found: ${abs}`);
  process.exit(2);
}

const lines = fs.readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim().length > 0);
const submissions: SessionSubmission[] = lines.map((l) => JSON.parse(l));

// First block of first-of-shift sessions is the cleanest baseline source —
// but for quick analysis we accept all PVT-B blocks.
const pvtBlocks: BlockResult[] = [];
for (const s of submissions) {
  for (const b of s.blocks) {
    if (b.block === 'pvt_b') pvtBlocks.push(b);
  }
}
if (pvtBlocks.length === 0) {
  console.error('no PVT-B blocks found in the dataset');
  process.exit(1);
}

const baseline = computeBaseline(pvtBlocks);
console.log('# Baseline proposal');
console.log(JSON.stringify(baseline, null, 2));
console.log('');

for (const target of [0.03, 0.05, 0.1]) {
  const cal = calibrateCutoffs(submissions, { targetRedRate: target });
  console.log(`# Cutoffs for target red rate ${(target * 100).toFixed(1)}%`);
  console.log(JSON.stringify(cal, null, 2));
  console.log('');
}

console.log('Next:');
console.log('  1) Update packages/scoring/src/norms.ts with the baseline values.');
console.log('  2) Bump ALGORITHM_VERSION to v2.');
console.log('  3) Replay persist_session_score for all historic sessions.');
console.log('  4) Only then flip block_policy.red from warn to block.');
