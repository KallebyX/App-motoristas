// Valores de normalização populacional para PVT-B (3 min) em motoristas adultos.
// Fonte: Basner M. et al., "Validity and Sensitivity of a Brief PVT (PVT-B)",
// Acta Astronautica 69 (2011) + literatura adicional para contexto mobile.
// Estes são defaults do MVP — serão recalibrados com dados próprios após
// coleta-sombra de 30 dias (ver plan.md: "Cutoffs PVT sem validação BR").
export const PVT_B_NORMS = {
  medianRtMs: { mean: 280, sd: 45 },
  lapseRate: { mean: 0.05, sd: 0.04 }, // fração de respostas > 500ms
  cvRt: { mean: 0.18, sd: 0.05 }, // coeficiente de variação
} as const;

// Limiares do semáforo para o score final (0-100).
export const TRAFFIC_LIGHT_CUTOFFS = {
  greenMin: 75,
  yellowMin: 55,
} as const;

// Limites duros que forçam vermelho independente do score combinado.
export const HARD_RED_RULES = {
  lapseRateThreshold: 0.2, // >20% de lapsos
  kssThreshold: 8, // KSS >= 8 = muito sonolento
  samnPerelliThreshold: 6, // 6 = extremely tired / 7 = completely exhausted
} as const;

// Pesos do score combinado.
export const SCORE_WEIGHTS = {
  objective: 0.6,
  subjective: 0.4,
} as const;

export const ALGORITHM_VERSION = 'v1';
