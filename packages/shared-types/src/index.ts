import { z } from 'zod';

export const TrafficLight = z.enum(['green', 'yellow', 'red']);
export type TrafficLight = z.infer<typeof TrafficLight>;

export const TestBlock = z.enum(['pvt_b', 'divided_attention', 'vigilance']);
export type TestBlock = z.infer<typeof TestBlock>;

export const SessionStatus = z.enum([
  'started',
  'liveness_ok',
  'in_test',
  'completed',
  'aborted',
  'fraud_suspect',
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const DriverStatus = z.enum(['pending_match', 'active', 'blocked', 'archived']);
export type DriverStatus = z.infer<typeof DriverStatus>;

// One stimulus-response trial within a cognitive block.
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

// Subjective questionnaire (KSS + Samn-Perelli).
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
export type GeoPoint = z.infer<typeof GeoPointSchema>;

// Payload uploaded by the mobile app when a session ends.
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

export const SessionScoreSchema = z.object({
  sessionId: z.string().uuid(),
  objectiveScore: z.number().min(0).max(100),
  subjectiveScore: z.number().min(0).max(100),
  finalScore: z.number().min(0).max(100),
  trafficLight: TrafficLight,
  blocked: z.boolean(),
  algorithmVersion: z.string(),
});
export type SessionScore = z.infer<typeof SessionScoreSchema>;

export const BlockPolicySchema = z.object({
  yellow: z.enum(['warn', 'block']).default('warn'),
  red: z.enum(['warn', 'block']).default('block'),
});
export type BlockPolicy = z.infer<typeof BlockPolicySchema>;
