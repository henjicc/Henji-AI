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
  const drift = Math.max(0, finalBytes - baselineBytes);
  const allowed = Math.max(
    IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftBytes,
    baselineBytes * IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftRatio,
  );
  return drift <= allowed;
}
