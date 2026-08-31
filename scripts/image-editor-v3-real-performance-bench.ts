import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { ContentAddressedResourceStore } from '../electron/main/services/image-editor-v3/resource-store';
import { SharpSourceProvider } from '../electron/main/services/image-editor-v3/source-provider';
import { BigTiffTileOutputSink } from '../electron/main/services/image-editor-v3/export/bigtiff-output-sink';
import { IncrementalBigTiffWriter } from '../electron/main/services/image-editor-v3/export/bigtiff-writer';
import { planBigTiff } from '../electron/main/services/image-editor-v3/export/bigtiff-layout';
import type {
  OutputTile,
  ResourceId,
  SourceTile,
  TileOutputDescription,
} from '../electron/main/services/image-editor-v3/contracts';
import {
  applyExposureAdjustment,
  applyGaussianBlurV2,
} from '../src/core/imageEdit/v3/effects';
import { decodeInterleavedRgbaSourceTileV3 } from '../src/core/imageEdit/v3/execution/sourceTileDecode';
import {
  IMAGE_EDIT_PERFORMANCE_TARGETS_V3,
  summarizeImageEditPerformanceV3,
  summarizeImageEditResourceDriftV3,
} from '../src/core/imageEdit/v3/performanceMetrics';
import { chooseViewportMip } from '../src/core/imageEdit/v3/tileGeometry';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const TILE_SIZE = 512;
const FORMAL_MAIN = { width: 20_000, height: 10_000 } as const;
const FORMAL_EXTREME = { width: 200_000, height: 1_000 } as const;
const QUICK_MAIN = { width: 2_048, height: 1_536 } as const;
const QUICK_EXTREME = { width: 8_192, height: 384 } as const;

interface DurationSample {
  metric: string;
  durationMs: number;
}

interface FixtureResult {
  name: string;
  width: number;
  height: number;
  pixels: number;
  tiles: number;
  byteLength: number;
  generationMs: number;
  resourceId: ResourceId;
}

interface SourceProbeResult {
  name: string;
  metadataColdMs: number;
  metadataWarmMs: number;
  proxyColdMs: number;
  proxyWarmMs: number;
  proxySize: { width: number; height: number; byteLength: number };
  coarseMip: number;
  coarseTileColdMs: number;
  coarseTileWarmMs: number;
}

interface GateResult {
  name: string;
  actual: number | boolean;
  limit: number | boolean;
  unit: 'ms' | 'bytes' | 'boolean';
  passed: boolean;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  const error = reason instanceof Error ? reason : new Error('真实像素性能验收已取消');
  if (error.name === 'Error') error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

async function measured<T>(metric: string, samples: DurationSample[], run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    samples.push({ metric, durationMs: performance.now() - startedAt });
  }
}

function createPatternTile(): Buffer {
  const pixels = Buffer.allocUnsafe(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const offset = (y * TILE_SIZE + x) * 4;
      pixels[offset] = (x * 3 + y) & 0xff;
      pixels[offset + 1] = (x + y * 5) & 0xff;
      pixels[offset + 2] = ((x >> 3) ^ (y >> 3)) & 1 ? 224 : 32;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function outputTile(
  pixels: Buffer,
  width: number,
  height: number,
  tileIndex: number,
): OutputTile {
  const columns = Math.ceil(width / TILE_SIZE);
  const tileX = tileIndex % columns;
  const tileY = Math.floor(tileIndex / columns);
  const x = tileX * TILE_SIZE;
  const y = tileY * TILE_SIZE;
  return {
    x,
    y,
    width: Math.min(TILE_SIZE, width - x),
    height: Math.min(TILE_SIZE, height - y),
    rowStride: TILE_SIZE * 4,
    pixels,
  };
}

async function writeFixture(
  name: string,
  outputPath: string,
  size: { width: number; height: number },
  pixels: Buffer,
  store: ContentAddressedResourceStore,
  signal: AbortSignal,
): Promise<FixtureResult> {
  const plan = planBigTiff({ ...size, channels: 4, bitDepth: 8 }, TILE_SIZE);
  const writer = new IncrementalBigTiffWriter(outputPath, {
    tileSize: TILE_SIZE,
    compressionLevel: 1,
  });
  const startedAt = performance.now();
  try {
    await writer.begin({
      ...size,
      channels: 4,
      bitDepth: 8,
      sampleFormat: 'uint',
      byteOrder: 'little-endian',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      documentId: `real-bench-${name}`,
      revision: 0,
    });
    for (let index = 0; index < plan.tileCount; index += 1) {
      throwIfAborted(signal);
      await writer.writeTile(outputTile(pixels, size.width, size.height, index));
      if (index % 16 === 15) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await writer.complete();
  } catch (error) {
    await writer.cancel().catch(() => undefined);
    throw error;
  }
  throwIfAborted(signal);
  const byteLength = (await fsp.stat(outputPath)).size;
  const resource = await store.putFile(outputPath, {
    mediaType: 'image/tiff',
    signal,
  });
  return {
    name,
    ...size,
    pixels: size.width * size.height,
    tiles: plan.tileCount,
    byteLength,
    generationMs: round(performance.now() - startedAt),
    resourceId: resource.id,
  };
}

async function probeSource(
  fixture: FixtureResult,
  provider: SharpSourceProvider,
  samples: DurationSample[],
  signal: AbortSignal,
): Promise<{ result: SourceProbeResult; targetTile: SourceTile }> {
  await measured(`${fixture.name}.metadata.cold`, samples, () => (
    provider.readMetadata(fixture.resourceId, signal)
  ));
  const metadata = await measured(`${fixture.name}.metadata.warm`, samples, () => (
    provider.readMetadata(fixture.resourceId, signal)
  ));
  if (metadata.width !== fixture.width || metadata.height !== fixture.height) {
    throw new Error(`${fixture.name} 元数据尺寸与真实像素夹具不一致`);
  }
  const proxy = await measured(`${fixture.name}.proxy.cold`, samples, () => (
    provider.readFastProxy(fixture.resourceId, 1_600, signal)
  ));
  await measured(`${fixture.name}.proxy.warm`, samples, () => (
    provider.readFastProxy(fixture.resourceId, 1_600, signal)
  ));
  const coarseMip = chooseViewportMip(fixture, { width: 1_440, height: 900 });
  await measured(`${fixture.name}.coarse-tile.cold`, samples, () => provider.readTile({
    resourceId: fixture.resourceId, mip: coarseMip, tileX: 0, tileY: 0, signal,
  }));
  await measured(`${fixture.name}.coarse-tile.warm`, samples, () => provider.readTile({
    resourceId: fixture.resourceId, mip: coarseMip, tileX: 0, tileY: 0, signal,
  }));
  const tileX = Math.max(0, Math.floor(fixture.width / TILE_SIZE / 2));
  const tileY = Math.max(0, Math.floor(fixture.height / TILE_SIZE / 2));
  const targetTile = await measured(`${fixture.name}.target-tile.cold`, samples, () => (
    provider.readTile({ resourceId: fixture.resourceId, mip: 0, tileX, tileY, signal })
  ));
  for (let index = 0; index < 5; index += 1) {
    await measured(`${fixture.name}.target-tile.warm`, samples, () => (
      provider.readTile({ resourceId: fixture.resourceId, mip: 0, tileX, tileY, signal })
    ));
  }
  for (let index = 0; index < 2; index += 1) {
    await measured(`${fixture.name}.region-halo`, samples, () => provider.readTile({
      resourceId: fixture.resourceId, mip: 0, tileX, tileY, halo: 24, signal,
    }));
  }
  const duration = (metric: string): number => round(
    samples.find((sample) => sample.metric === `${fixture.name}.${metric}`)?.durationMs ?? 0,
  );
  return {
    result: {
      name: fixture.name,
      metadataColdMs: duration('metadata.cold'),
      metadataWarmMs: duration('metadata.warm'),
      proxyColdMs: duration('proxy.cold'),
      proxyWarmMs: duration('proxy.warm'),
      proxySize: { width: proxy.width, height: proxy.height, byteLength: proxy.bytes.byteLength },
      coarseMip,
      coarseTileColdMs: duration('coarse-tile.cold'),
      coarseTileWarmMs: duration('coarse-tile.warm'),
    },
    targetTile,
  };
}

async function probeCpuKernels(
  source: SourceTile,
  signal: AbortSignal,
): Promise<{ decodeMs: number; exposureMs: number; blurMs: number; checksum: number }> {
  throwIfAborted(signal);
  let startedAt = performance.now();
  const decoded = decodeInterleavedRgbaSourceTileV3(source, 'srgb');
  const decodeMs = performance.now() - startedAt;
  startedAt = performance.now();
  const exposed = applyExposureAdjustment(decoded, { stops: 0.5, offset: 0.01, gamma: 1.05 });
  const exposureMs = performance.now() - startedAt;
  startedAt = performance.now();
  const blurred = applyGaussianBlurV2(decoded, { radius: 4, mip: 0 });
  const blurMs = performance.now() - startedAt;
  throwIfAborted(signal);
  return {
    decodeMs: round(decodeMs),
    exposureMs: round(exposureMs),
    blurMs: round(blurMs),
    checksum: round(exposed.data[0] + blurred.data.at(-1)!),
  };
}

async function probeInteractionDrift(
  source: SourceTile,
  signal: AbortSignal,
): Promise<ReturnType<typeof summarizeImageEditResourceDriftV3> & { rssPeakBytes: number }> {
  const decoded = decodeInterleavedRgbaSourceTileV3(source, 'srgb');
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const samples = [{ operation: 0, totalBytes: process.memoryUsage().arrayBuffers }];
  let rssPeakBytes = process.memoryUsage().rss;
  let last = decoded;
  for (let operation = 1; operation <= 100; operation += 1) {
    throwIfAborted(signal);
    last = applyExposureAdjustment(decoded, {
      stops: ((operation % 17) - 8) / 8,
      offset: 0,
      gamma: 1,
    });
    const memory = process.memoryUsage();
    rssPeakBytes = Math.max(rssPeakBytes, memory.rss);
    samples.push({ operation, totalBytes: memory.arrayBuffers });
    if (operation % 5 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!Number.isFinite(last.data[0])) throw new Error('CPU 点式交互输出无效');
  gc?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  gc?.();
  samples.push({ operation: 101, totalBytes: process.memoryUsage().arrayBuffers });
  return { ...summarizeImageEditResourceDriftV3(samples), rssPeakBytes };
}

async function probeBoundedExport(
  outputPath: string,
  size: { width: number; height: number },
  pixels: Buffer,
  signal: AbortSignal,
): Promise<{ durationMs: number; byteLength: number; tiles: number }> {
  const plan = planBigTiff({ ...size, channels: 4, bitDepth: 8 }, TILE_SIZE);
  const sink = new BigTiffTileOutputSink(outputPath, {
    inputByteOrder: 'little-endian', tileSize: TILE_SIZE, compressionLevel: 1,
  });
  const description: TileOutputDescription = {
    ...size,
    channels: 4,
    bitDepth: 8,
    sampleFormat: 'uint',
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    documentId: 'real-bench-export',
    revision: 1,
    sourceFingerprint: 'real-pixel-benchmark',
  };
  const startedAt = performance.now();
  try {
    await sink.begin(description);
    for (let index = 0; index < plan.tileCount; index += 1) {
      throwIfAborted(signal);
      await sink.writeTile(outputTile(pixels, size.width, size.height, index));
      if (index % 16 === 15) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await sink.complete();
  } catch (error) {
    await sink.cancel(error).catch(() => undefined);
    throw error;
  }
  return {
    durationMs: round(performance.now() - startedAt),
    byteLength: (await fsp.stat(outputPath)).size,
    tiles: plan.tileCount,
  };
}

function summary(samples: DurationSample[], metric: string) {
  const value = summarizeImageEditPerformanceV3(samples, metric);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, round(entry)]));
}

function gate(name: string, actual: number, limit: number, unit: 'ms' | 'bytes'): GateResult {
  return { name, actual: round(actual), limit, unit, passed: actual <= limit };
}

async function main(): Promise<void> {
  const quick = process.argv.slice(2).includes('--quick');
  const unexpected = process.argv.slice(2).filter((argument) => argument !== '--quick');
  if (unexpected.length > 0) throw new Error(`未知参数：${unexpected.join(', ')}`);
  const sizes = quick
    ? { main: QUICK_MAIN, extreme: QUICK_EXTREME }
    : { main: FORMAL_MAIN, extreme: FORMAL_EXTREME };
  const controller = new AbortController();
  const cancel = (signalName: string): void => controller.abort(new Error(`收到 ${signalName}`));
  const onSigint = (): void => cancel('SIGINT');
  const onSigterm = (): void => cancel('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-real-perf-'));
  const rssBaselineBytes = process.memoryUsage().rss;
  let rssPeakBytes = rssBaselineBytes;
  const monitor = setInterval(() => {
    rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss);
  }, 20);
  monitor.unref();
  const startedAt = performance.now();
  try {
    const store = new ContentAddressedResourceStore(path.join(rootDir, 'resources'));
    const pattern = createPatternTile();
    const mainFixture = await writeFixture(
      'main-200mp', path.join(rootDir, 'main.tif'), sizes.main, pattern, store, controller.signal,
    );
    const extremeFixture = await writeFixture(
      'extreme-200mp', path.join(rootDir, 'extreme.tif'), sizes.extreme, pattern, store, controller.signal,
    );
    const provider = new SharpSourceProvider(store);
    const samples: DurationSample[] = [];
    const mainProbe = await probeSource(mainFixture, provider, samples, controller.signal);
    const extremeProbe = await probeSource(extremeFixture, provider, samples, controller.signal);
    const cpu = await probeCpuKernels(mainProbe.targetTile, controller.signal);
    const drift = await probeInteractionDrift(mainProbe.targetTile, controller.signal);
    rssPeakBytes = Math.max(rssPeakBytes, drift.rssPeakBytes, process.memoryUsage().rss);
    const exported = await probeBoundedExport(
      path.join(rootDir, 'bounded-export.tif'), sizes.main, pattern, controller.signal,
    );
    rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss);
    const mainWarmTarget = summary(samples, 'main-200mp.target-tile.warm');
    const mainRegion = summary(samples, 'main-200mp.region-halo');
    const extremeWarmTarget = summary(samples, 'extreme-200mp.target-tile.warm');
    const extremeRegion = summary(samples, 'extreme-200mp.region-halo');
    const gates: GateResult[] = quick ? [] : [
      gate('main cold proxy', mainProbe.result.proxyColdMs, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.coldOpenProxyMs, 'ms'),
      gate('main warm proxy', mainProbe.result.proxyWarmMs, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.warmOpenMs, 'ms'),
      gate('extreme cold proxy', extremeProbe.result.proxyColdMs, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.coldOpenProxyMs, 'ms'),
      gate('extreme warm proxy', extremeProbe.result.proxyWarmMs, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.warmOpenMs, 'ms'),
      gate('main coarse tile', mainProbe.result.coarseTileColdMs, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.coarseTileMs, 'ms'),
      gate('extreme coarse tile', extremeProbe.result.coarseTileColdMs, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.coarseTileMs, 'ms'),
      gate('main target tile p95', Number(mainWarmTarget.p95Ms), IMAGE_EDIT_PERFORMANCE_TARGETS_V3.targetTileP95Ms, 'ms'),
      gate('extreme target tile p95', Number(extremeWarmTarget.p95Ms), IMAGE_EDIT_PERFORMANCE_TARGETS_V3.targetTileP95Ms, 'ms'),
      gate('peak incremental RSS', rssPeakBytes - rssBaselineBytes, IMAGE_EDIT_PERFORMANCE_TARGETS_V3.incrementalRssBytes, 'bytes'),
      { name: '100 interaction retained buffer drift', actual: drift.driftBytes, limit: drift.allowedDriftBytes, unit: 'bytes', passed: drift.withinLimit },
    ];
    const failedGates = gates.filter((entry) => !entry.passed);
    const report = {
      schemaVersion: 1,
      status: failedGates.length === 0 ? 'passed' : 'failed',
      mode: quick ? 'quick-self-test' : 'formal-200mp',
      releaseQualification: quick ? 'not-applicable' : 'partial-node-pixel-only',
      host: {
        platform: process.platform,
        architecture: process.arch,
        osRelease: os.release(),
        node: process.version,
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        gpu: 'not-measured',
        storageClass: 'not-measured',
      },
      releaseReference: {
        memoryBytes: 8 * GIB,
        gpu: 'integrated WebGPU',
        storage: 'NVMe',
        primaryImage: FORMAL_MAIN,
        extremeImage: FORMAL_EXTREME,
      },
      fixtures: [mainFixture, extremeFixture],
      measurements: {
        sources: [mainProbe.result, extremeProbe.result],
        targetTileCold: summary(samples, 'main-200mp.target-tile.cold'),
        targetTileWarm: mainWarmTarget,
        regionHalo: mainRegion,
        extremeTargetTileWarm: extremeWarmTarget,
        extremeRegionHalo: extremeRegion,
        cpuTile512: cpu,
        interactionDrift: { metric: 'process.memoryUsage().arrayBuffers', ...drift },
        boundedBigTiffExport: exported,
        rss: {
          samplingIntervalMs: 20,
          baselineBytes: rssBaselineBytes,
          peakBytes: rssPeakBytes,
          peakIncrementBytes: Math.max(0, rssPeakBytes - rssBaselineBytes),
        },
      },
      gates,
      notMeasured: [
        'Electron pointer/crop/paint main-thread latency',
        'WebGPU draft/stable-frame latency and GPU memory',
        'global Glow Pro preview',
        'UI cancellation acknowledgement and device-lost recovery',
        'HDR display/tone-map correctness',
        'export regression versus a locked same-host baseline',
      ],
      totalDurationMs: round(performance.now() - startedAt),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write([
      `图片编辑 V3 真实像素验收：${report.status.toUpperCase()} (${report.mode})`,
      `夹具：${mainFixture.width}×${mainFixture.height} + ${extremeFixture.width}×${extremeFixture.height}`,
      `冷代理：${mainProbe.result.proxyColdMs}ms；热代理：${mainProbe.result.proxyWarmMs}ms`,
      `目标瓦片热读 p95：${String(mainWarmTarget.p95Ms)}ms；halo 区域 p95：${String(mainRegion.p95Ms)}ms`,
      `峰值 RSS 增量：${round((rssPeakBytes - rssBaselineBytes) / MIB)}MiB；100 次交互保留缓冲漂移：${round(drift.driftBytes / MIB)}MiB`,
      `有界 BigTIFF 导出：${exported.durationMs}ms / ${round(exported.byteLength / MIB)}MiB`,
      quick ? 'quick 仅证明脚本可运行，不执行 200MP 发布门槛。' : '结论只覆盖当前主机 Node 真实像素链路，Electron/WebGPU/HDR 仍需独立验收。',
    ].join('\n') + '\n');
    if (failedGates.length > 0) process.exitCode = 1;
  } finally {
    clearInterval(monitor);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
