export const IMAGE_EDIT_PERFORMANCE_TARGETS_V3 = {
  interactionMainThreadP95Ms: 16.7,
  longTaskThresholdMs: 50,
  coldOpenWithEmbeddedThumbnailMs: 2_000,
  coldOpenProxyMs: 5_000,
  warmOpenMs: 500,
  pointwiseDraftP95Ms: 150,
  localBlurDraftP95Ms: 250,
  globalGlowDraftP95Ms: 500,
  stableFrameMs: 1_000,
  coarseTileMs: 150,
  targetTileP95Ms: 400,
  cancelUiConfirmationMs: 50,
  cancelResourceReleaseMs: 1_000,
  incrementalRssBytes: 1_342_177_280,
  resourceDriftRatio: 0.05,
  resourceDriftBytes: 20 * 1024 * 1024,
  deviceRecoveryMs: 2_000,
  exportRegressionRatio: 0.15,
} as const;

export interface ImageEditPerformanceSampleV3 {
  metric: string;
  durationMs: number;
  documentId?: string;
  revision?: number;
  backend?: string;
}

export interface ImageEditPerformanceSummaryV3 {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface ImageEditResourceUsageSampleV3 {
  operation: number;
  totalBytes: number;
}

export interface ImageEditResourceDriftSummaryV3 {
  sampleCount: number;
  baselineBytes: number;
  finalBytes: number;
  peakBytes: number;
  driftBytes: number;
  allowedDriftBytes: number;
  withinLimit: boolean;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function summarizeImageEditPerformanceV3(
  samples: readonly ImageEditPerformanceSampleV3[],
  metric: string,
): ImageEditPerformanceSummaryV3 {
  const durations = samples
    .filter((sample) => sample.metric === metric && Number.isFinite(sample.durationMs))
    .map((sample) => Math.max(0, sample.durationMs))
    .sort((left, right) => left - right);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    count: durations.length,
    minMs: durations[0] ?? 0,
    maxMs: durations.at(-1) ?? 0,
    meanMs: durations.length > 0 ? total / durations.length : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
}

export function imageEditResourceDriftWithinLimitV3(
  baselineBytes: number,
  finalBytes: number,
): boolean {
  const normalizedBaseline = Math.max(0, baselineBytes);
  const normalizedFinal = Math.max(0, finalBytes);
  const drift = Math.max(0, normalizedFinal - normalizedBaseline);
  const allowed = Math.max(
    IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftBytes,
    normalizedBaseline * IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftRatio,
  );
  return drift <= allowed;
}

export function summarizeImageEditResourceDriftV3(
  samples: readonly ImageEditResourceUsageSampleV3[],
): ImageEditResourceDriftSummaryV3 {
  const values = samples
    .filter((sample) => Number.isFinite(sample.totalBytes))
    .map((sample) => Math.max(0, sample.totalBytes));
  const baselineBytes = values[0] ?? 0;
  const finalBytes = values.at(-1) ?? baselineBytes;
  const peakBytes = values.reduce((peak, value) => Math.max(peak, value), baselineBytes);
  const driftBytes = Math.max(0, finalBytes - baselineBytes);
  const allowedDriftBytes = Math.max(
    IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftBytes,
    baselineBytes * IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftRatio,
  );
  return {
    sampleCount: values.length,
    baselineBytes,
    finalBytes,
    peakBytes,
    driftBytes,
    allowedDriftBytes,
    withinLimit: driftBytes <= allowedDriftBytes,
  };
}
