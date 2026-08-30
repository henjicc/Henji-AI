import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  IMAGE_EDIT_PERFORMANCE_TARGETS_V3,
  summarizeImageEditPerformanceV3,
  summarizeImageEditResourceDriftV3,
  type ImageEditPerformanceSampleV3,
} from '../src/core/imageEdit/v3/performanceMetrics';
import {
  IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES,
  IMAGE_EDIT_DEFAULT_GPU_TARGET_BYTES,
  IMAGE_EDIT_DEFAULT_TOTAL_BUDGET_BYTES,
  ImageEditResourceBudget,
  type ImageEditMemoryLease,
} from '../src/core/imageEdit/v3/resourceBudget';
import {
  ImageEditRenderScheduler,
  ImageEditTaskSupersededError,
} from '../src/core/imageEdit/v3/renderScheduler';
import {
  chooseViewportMip,
  gaussianBlurHalo,
  planTileExecution,
} from '../src/core/imageEdit/v3/tileGeometry';

const MIB = 1024 * 1024;
const TWO_HUNDRED_MEGAPIXELS = { width: 20_000, height: 10_000 } as const;
const EXTREME_LANDSCAPE = { width: 200_000, height: 1_000 } as const;
const EXTREME_PORTRAIT = { width: 1_000, height: 200_000 } as const;
const PLANNER_P95_LIMIT_MS = 25;
const MAX_HARNESS_RSS_DELTA_BYTES = 64 * MIB;

interface PlannerAcceptanceResult {
  duration: ReturnType<typeof summarizeImageEditPerformanceV3>;
  rssDeltaBytes: number;
  fullFrameRgbaBytesNotAllocated: number;
  referencePlan: ReturnType<typeof planTileExecution>;
  fallbackPlan: ReturnType<typeof planTileExecution>;
  extremeLandscapeExecutionUnits: number;
  extremePortraitExecutionUnits: number;
}

interface SchedulerAcceptanceResult {
  enqueueDuration: ReturnType<typeof summarizeImageEditPerformanceV3>;
  scheduledPreviewCount: number;
  maxPendingPreviewSessions: number;
  maxActivePreviewSessions: number;
  supersededCount: number;
  successfulTaskId: string;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function measurePlannerAcceptance(): PlannerAcceptanceResult {
  const halo = gaussianBlurHalo(64, 0);
  const rssBefore = process.memoryUsage().rss;
  const samples: ImageEditPerformanceSampleV3[] = [];
  let referencePlan = planTileExecution(TWO_HUNDRED_MEGAPIXELS, 0);
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const startedAt = performance.now();
    referencePlan = planTileExecution(TWO_HUNDRED_MEGAPIXELS, 0, {
      halo,
      bytesPerPixel: 8,
      workingSurfaceCount: 2,
      maxWorkingSetBytes: 32 * MIB,
    });
    samples.push({ metric: 'tile-plan', durationMs: performance.now() - startedAt });
  }
  const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
  const duration = summarizeImageEditPerformanceV3(samples, 'tile-plan');
  const fallbackPlan = planTileExecution(TWO_HUNDRED_MEGAPIXELS, 0, {
    halo,
    bytesPerPixel: 8,
    workingSurfaceCount: 2,
    maxWorkingSetBytes: 16 * MIB,
  });
  const extremeLandscape = planTileExecution(EXTREME_LANDSCAPE, 0, {
    halo,
    maxWorkingSetBytes: 32 * MIB,
  });
  const extremePortrait = planTileExecution(EXTREME_PORTRAIT, 0, {
    halo,
    maxWorkingSetBytes: 32 * MIB,
  });

  assert.equal(chooseViewportMip(TWO_HUNDRED_MEGAPIXELS, { width: 1_440, height: 900 }), 3);
  assert.equal(referencePlan.storageTileCount, 800);
  assert.equal(referencePlan.executionUnitCount, 200);
  assert.equal(referencePlan.executionTileSize, 1_024);
  assert.equal(referencePlan.usesSupertile, true);
  assert.equal(referencePlan.halo, 192);
  assert.equal(referencePlan.estimatedWorkingSetBytes, 31_719_424);
  assert.equal(fallbackPlan.executionTileSize, 512);
  assert.equal(fallbackPlan.executionUnitCount, 800);
  assert.equal(fallbackPlan.estimatedWorkingSetBytes, 12_845_056);
  assert.equal(extremeLandscape.storageTileCount, 782);
  assert.equal(extremeLandscape.executionUnitCount, 196);
  assert.equal(extremePortrait.storageTileCount, 782);
  assert.equal(extremePortrait.executionUnitCount, 196);
  assert.throws(() => planTileExecution(TWO_HUNDRED_MEGAPIXELS, 0, {
    halo,
    maxWorkingSetBytes: 12 * MIB,
  }), /工作集预算不足/);
  assert.ok(duration.p95Ms <= PLANNER_P95_LIMIT_MS, `200MP 规划 p95 ${duration.p95Ms}ms 超过 ${PLANNER_P95_LIMIT_MS}ms`);
  assert.ok(
    rssDeltaBytes <= MAX_HARNESS_RSS_DELTA_BYTES,
    `只读规划 RSS 增量 ${rssDeltaBytes} 超过 ${MAX_HARNESS_RSS_DELTA_BYTES}`,
  );

  return {
    duration,
    rssDeltaBytes,
    fullFrameRgbaBytesNotAllocated: TWO_HUNDRED_MEGAPIXELS.width
      * TWO_HUNDRED_MEGAPIXELS.height * 4,
    referencePlan,
    fallbackPlan,
    extremeLandscapeExecutionUnits: extremeLandscape.executionUnitCount,
    extremePortraitExecutionUnits: extremePortrait.executionUnitCount,
  };
}

function measureBudgetAcceptance() {
  const rssBefore = process.memoryUsage().rss;
  const budget = new ImageEditResourceBudget();
  const remainingBytes = IMAGE_EDIT_DEFAULT_TOTAL_BUDGET_BYTES
    - IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES
    - IMAGE_EDIT_DEFAULT_GPU_TARGET_BYTES;
  const leases: ImageEditMemoryLease[] = [];
  for (const [category, bytes] of [
    ['cpu-cache', IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES],
    ['gpu', IMAGE_EDIT_DEFAULT_GPU_TARGET_BYTES],
    ['transfer', remainingBytes],
  ] as const) {
    const lease = budget.acquire(category, bytes);
    assert.ok(lease, `${category} 的参考预算应可被接纳`);
    leases.push(lease);
  }
  const saturated = budget.snapshot();
  const rejection = budget.admission('encode', 1);
  assert.equal(saturated.totalBytes, IMAGE_EDIT_DEFAULT_TOTAL_BUDGET_BYTES);
  assert.equal(saturated.leaseCount, 3);
  assert.deepEqual(rejection, {
    admitted: false,
    availableBytes: 0,
    pressure: 'hard',
    recommendation: 'lower-mip',
  });
  assert.equal(budget.acquire('in-flight', 1), null);
  for (const lease of leases) lease.release();
  assert.deepEqual(budget.snapshot(), {
    totalBytes: 0,
    byCategory: {
      'cpu-cache': 0,
      gpu: 0,
      transfer: 0,
      encode: 0,
      'in-flight': 0,
    },
    leaseCount: 0,
    deviceGeneration: 0,
  });
  const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
  assert.ok(
    rssDeltaBytes <= MAX_HARNESS_RSS_DELTA_BYTES,
    `资源账本不得按声明预算分配真实内存，RSS 增量为 ${rssDeltaBytes}`,
  );
  return { saturated, rejection, rssDeltaBytes };
}

function measureResourceDriftAcceptance() {
  const budget = new ImageEditResourceBudget();
  const baselineLease = budget.acquire('cpu-cache', 64 * MIB);
  assert.ok(baselineLease);
  const samples = [{ operation: 0, totalBytes: budget.snapshot().totalBytes }];
  for (let operation = 1; operation <= 100; operation += 1) {
    const category = operation % 3 === 0 ? 'gpu' : 'in-flight';
    const lease = budget.acquire(category, 24 * MIB);
    assert.ok(lease, `第 ${operation} 次交互工作集应被接纳`);
    samples.push({ operation: operation - 0.5, totalBytes: budget.snapshot().totalBytes });
    lease.release();
    samples.push({ operation, totalBytes: budget.snapshot().totalBytes });
  }
  const summary = summarizeImageEditResourceDriftV3(samples);
  assert.equal(summary.sampleCount, 201);
  assert.equal(summary.baselineBytes, 64 * MIB);
  assert.equal(summary.peakBytes, 88 * MIB);
  assert.equal(summary.finalBytes, 64 * MIB);
  assert.equal(summary.driftBytes, 0);
  assert.equal(summary.withinLimit, true);
  baselineLease.release();
  assert.equal(budget.snapshot().totalBytes, 0);
  assert.equal(budget.snapshot().leaseCount, 0);
  return summary;
}

async function measureSchedulerAcceptance(): Promise<SchedulerAcceptanceResult> {
  const scheduler = new ImageEditRenderScheduler();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const outcomes: Promise<{ id: string; status: 'fulfilled' | 'superseded' }>[] = [];
  const observe = (id: string, promise: Promise<string>) => promise.then(
    () => ({ id, status: 'fulfilled' as const }),
    (error: unknown) => {
      if (error instanceof ImageEditTaskSupersededError) {
        return { id, status: 'superseded' as const };
      }
      throw error;
    },
  );
  const first = scheduler.schedule({
    id: 'preview-0',
    sessionId: 'perf-session',
    revision: 0,
    kind: 'preview',
    lane: 'gpu',
    priority: 500,
    run: async () => {
      await firstGate;
      return 'preview-0';
    },
  });
  outcomes.push(observe('preview-0', first));

  let maxPendingPreviewSessions = 0;
  let maxActivePreviewSessions = 0;
  const enqueueSamples: ImageEditPerformanceSampleV3[] = [];
  for (let revision = 1; revision <= 100; revision += 1) {
    const id = `preview-${revision}`;
    const startedAt = performance.now();
    const promise = scheduler.schedule({
      id,
      sessionId: 'perf-session',
      revision,
      kind: 'preview',
      lane: 'gpu',
      priority: 500,
      run: async () => id,
    });
    enqueueSamples.push({ metric: 'preview-enqueue', durationMs: performance.now() - startedAt });
    outcomes.push(observe(id, promise));
    const snapshot = scheduler.snapshot();
    maxPendingPreviewSessions = Math.max(
      maxPendingPreviewSessions,
      snapshot.pendingPreviewSessions,
    );
    maxActivePreviewSessions = Math.max(
      maxActivePreviewSessions,
      snapshot.activePreviewSessions,
    );
  }
  assert.equal(maxPendingPreviewSessions, 1);
  assert.equal(maxActivePreviewSessions, 1);
  releaseFirst();
  const results = await Promise.all(outcomes);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const supersededCount = results.filter((result) => result.status === 'superseded').length;
  const enqueueDuration = summarizeImageEditPerformanceV3(enqueueSamples, 'preview-enqueue');
  assert.deepEqual(fulfilled, [{ id: 'preview-100', status: 'fulfilled' }]);
  assert.equal(supersededCount, 100);
  assert.ok(
    enqueueDuration.p95Ms <= IMAGE_EDIT_PERFORMANCE_TARGETS_V3.interactionMainThreadP95Ms,
    `latest-only 入队 p95 ${enqueueDuration.p95Ms}ms 超过交互门槛`,
  );
  assert.deepEqual(scheduler.snapshot(), {
    runningGpu: 0,
    runningCpu: 0,
    pendingPreviewSessions: 0,
    pendingOtherTasks: 0,
    activePreviewSessions: 0,
  });
  return {
    enqueueDuration,
    scheduledPreviewCount: outcomes.length,
    maxPendingPreviewSessions,
    maxActivePreviewSessions,
    supersededCount,
    successfulTaskId: fulfilled[0].id,
  };
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  const planner = measurePlannerAcceptance();
  const budget = measureBudgetAcceptance();
  const resourceDrift = measureResourceDriftAcceptance();
  const scheduler = await measureSchedulerAcceptance();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: 'passed',
    referenceImage: TWO_HUNDRED_MEGAPIXELS,
    limits: {
      totalResourceBytes: IMAGE_EDIT_DEFAULT_TOTAL_BUDGET_BYTES,
      plannerP95Ms: PLANNER_P95_LIMIT_MS,
      enqueueP95Ms: IMAGE_EDIT_PERFORMANCE_TARGETS_V3.interactionMainThreadP95Ms,
      maxPendingPreviewPerSession: 1,
      resourceDriftRatio: IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftRatio,
      resourceDriftBytes: IMAGE_EDIT_PERFORMANCE_TARGETS_V3.resourceDriftBytes,
    },
    measurements: {
      planner: {
        p95Ms: round(planner.duration.p95Ms),
        maxMs: round(planner.duration.maxMs),
        rssDeltaBytes: planner.rssDeltaBytes,
        fullFrameRgbaBytesNotAllocated: planner.fullFrameRgbaBytesNotAllocated,
        storageTiles: planner.referencePlan.storageTileCount,
        supertiles: planner.referencePlan.executionUnitCount,
        halo: planner.referencePlan.halo,
        supertileWorkingSetBytes: planner.referencePlan.estimatedWorkingSetBytes,
        fallbackTileWorkingSetBytes: planner.fallbackPlan.estimatedWorkingSetBytes,
        extremeLandscapeExecutionUnits: planner.extremeLandscapeExecutionUnits,
        extremePortraitExecutionUnits: planner.extremePortraitExecutionUnits,
      },
      budget: {
        saturatedBytes: budget.saturated.totalBytes,
        hardRejectionAvailableBytes: budget.rejection.availableBytes,
        rssDeltaBytes: budget.rssDeltaBytes,
      },
      resourceDrift,
      scheduler: {
        ...scheduler,
        enqueueDuration: {
          ...scheduler.enqueueDuration,
          meanMs: round(scheduler.enqueueDuration.meanMs),
          p50Ms: round(scheduler.enqueueDuration.p50Ms),
          p95Ms: round(scheduler.enqueueDuration.p95Ms),
          minMs: round(scheduler.enqueueDuration.minMs),
          maxMs: round(scheduler.enqueueDuration.maxMs),
        },
      },
    },
    totalDurationMs: round(performance.now() - startedAt),
  }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
