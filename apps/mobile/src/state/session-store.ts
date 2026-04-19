import type { BlockResult, SubjectiveAnswers } from '@app-motoristas/shared-types';

// Very small in-memory session cache. Good enough for MVP (single flow).
// Promote to Zustand if we need persistence across reloads.
interface SessionDraft {
  sessionId: string;
  startedAt: string;
  blocks: BlockResult[];
  subjective?: SubjectiveAnswers;
  livenessVideoRef?: string;
}

let draft: SessionDraft | null = null;

function uuid(): string {
  // RFC 4122 v4 — crypto on the JS runtime (Hermes) provides getRandomValues.
  const bytes = new Uint8Array(16);
  // @ts-expect-error — Hermes exposes global crypto.
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function startDraft(): SessionDraft {
  draft = {
    sessionId: uuid(),
    startedAt: new Date().toISOString(),
    blocks: [],
  };
  return draft;
}

export function getDraft(): SessionDraft {
  if (!draft) return startDraft();
  return draft;
}

export function addBlockResult(block: BlockResult): void {
  const d = getDraft();
  d.blocks = d.blocks.filter((b) => b.block !== block.block).concat(block);
}

export function setSubjective(subjective: SubjectiveAnswers): void {
  getDraft().subjective = subjective;
}

export function setLivenessRef(ref: string): void {
  getDraft().livenessVideoRef = ref;
}

export function clearDraft(): void {
  draft = null;
}
