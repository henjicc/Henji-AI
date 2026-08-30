import { effect, frame, target } from 'vgpu';
import type { Gpu, Target } from 'vgpu';

const RGBA_COMPONENTS = 4;
const HALF_FLOAT_MAX = 65_504;

export type VgpuImpulseChannel = 0 | 1 | 2 | 3;

export interface VgpuImpulseChannelMetrics {
  readonly channel: VgpuImpulseChannel;
  /** 保留符号的离散积分，用于发现读回中的负瓣。 */
  readonly signedEnergy: number;
  /** 只用正值积分。质心与半径以它为质量，避免负瓣互相抵消。 */
  readonly positiveEnergy: number;
  /** 所有负值绝对值之和；物理散射核应接近 0。 */
  readonly negativeEnergy: number;
  readonly peak: {
    readonly value: number;
    readonly x: number;
    readonly y: number;
  };
  readonly centroid: readonly [number, number] | null;
  readonly centroidOffsetPx: readonly [number, number] | null;
  readonly rmsRadiusPx: number | null;
  readonly nonFiniteSamples: number;
}

export interface VgpuImpulseAnalysis {
  readonly width: number;
  readonly height: number;
  readonly expectedCenter: readonly [number, number];
  readonly channels: readonly [
    VgpuImpulseChannelMetrics,
    VgpuImpulseChannelMetrics,
    VgpuImpulseChannelMetrics,
    VgpuImpulseChannelMetrics,
  ];
}

export interface VgpuHdrImpulseProbeResult {
  readonly format: 'rgba16float';
  readonly pixels: Float32Array;
  readonly analysis: VgpuImpulseAnalysis;
}

export interface VgpuHdrImpulseProbeOptions {
  readonly size?: readonly [number, number];
  readonly center?: readonly [number, number];
  readonly value?: readonly [number, number, number, number];
}

/**
 * 分析 VGPU `Target.readFloats()` 的 row-major RGBA 数据。
 *
 * 这是纯函数，日常单测只覆盖这里；真实 GPU 的设备/驱动差异由显式 probe 覆盖。
 */
export function analyzeVgpuImpulseReadback(input: {
  readonly pixels: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly expectedCenter?: readonly [number, number];
}): VgpuImpulseAnalysis {
  const width = assertDimension(input.width, 'width');
  const height = assertDimension(input.height, 'height');
  const expectedLength = width * height * RGBA_COMPONENTS;
  if (input.pixels.length !== expectedLength) {
    throw new Error(
      `VGPU impulse 读回长度无效：期望 ${expectedLength}，实际 ${input.pixels.length}`
    );
  }
  const expectedCenter = input.expectedCenter
    ? assertCoordinate(input.expectedCenter, width, height)
    : [(width - 1) / 2, (height - 1) / 2] as const;

  return {
    width,
    height,
    expectedCenter,
    channels: [
      analyzeChannel(input.pixels, width, height, 0, expectedCenter),
      analyzeChannel(input.pixels, width, height, 1, expectedCenter),
      analyzeChannel(input.pixels, width, height, 2, expectedCenter),
      analyzeChannel(input.pixels, width, height, 3, expectedCenter),
    ],
  };
}

/**
 * 从真实 VGPU target 读取 HDR 浮点像素并计算 impulse 指标。
 * 官方将 `readFloats()` 定位为测试/诊断能力，禁止放进逐帧渲染热路径。
 */
export async function readAndAnalyzeVgpuImpulseTarget(input: {
  readonly source: Target;
  readonly expectedCenter?: readonly [number, number];
}): Promise<VgpuImpulseAnalysis> {
  if (input.source.format !== 'rgba16float') {
    throw new Error(`VGPU impulse probe 需要 rgba16float target，实际为 ${input.source.format}`);
  }
  const pixels = await input.source.readFloats();
  return analyzeVgpuImpulseReadback({
    pixels,
    width: input.source.size[0],
    height: input.source.size[1],
    expectedCenter: input.expectedCenter,
  });
}

/**
 * 最小真实 VGPU HDR readback 探针。
 *
 * 调用方拥有 `gpu` 生命周期；本函数只销毁自己创建的 target。它刻意不接入任何生产入口，
 * 只用于显式专项验证 `rgba16float` 是否保留 >1 的 HDR 数值，以及分析器的能量/质心契约。
 */
export async function runVgpuHdrImpulseProbe(
  gpu: Gpu,
  options: VgpuHdrImpulseProbeOptions = {}
): Promise<VgpuHdrImpulseProbeResult> {
  const size = normalizeProbeSize(options.size ?? [65, 65]);
  const center = options.center
    ? assertIntegerCoordinate(options.center, size[0], size[1])
    : [Math.floor(size[0] / 2), Math.floor(size[1] / 2)] as const;
  const value = normalizeProbeValue(options.value ?? [8, 4, 2, 1]);
  const hdrTarget = target(gpu, {
    size,
    format: 'rgba16float',
    label: 'image-edit-vgpu-glow-impulse-probe',
  });
  const impulseEffect = effect(
    gpu,
    createImpulseShader(center, value),
    { label: 'VGPU 辉光 HDR impulse 诊断' }
  );
  let reportedError: Error | null = null;
  const stopListening = gpu.onError((error) => {
    reportedError = error instanceof Error ? error : new Error(String(error));
  });

  try {
    await impulseEffect.compile(hdrTarget);
    const submitted = frame(gpu, (currentFrame) => {
      currentFrame.pass({ target: hdrTarget, clear: [0, 0, 0, 0] }, impulseEffect);
    });
    await submitted.done;
    await gpu.settled();
    const renderError = reportedError as Error | null;
    if (renderError) {
      throw new Error(`VGPU HDR impulse probe 渲染失败：${renderError.message}`);
    }

    const pixels = await hdrTarget.readFloats();
    await gpu.settled();
    const readbackError = reportedError as Error | null;
    if (readbackError) {
      throw new Error(`VGPU HDR impulse probe 读回失败：${readbackError.message}`);
    }
    return {
      format: 'rgba16float',
      pixels,
      analysis: analyzeVgpuImpulseReadback({
        pixels,
        width: size[0],
        height: size[1],
        expectedCenter: center,
      }),
    };
  } finally {
    stopListening();
    destroyTarget(hdrTarget);
  }
}

function analyzeChannel(
  pixels: Float32Array,
  width: number,
  height: number,
  channel: VgpuImpulseChannel,
  expectedCenter: readonly [number, number]
): VgpuImpulseChannelMetrics {
  let signedEnergy = 0;
  let positiveEnergy = 0;
  let negativeEnergy = 0;
  let weightedX = 0;
  let weightedY = 0;
  let peakValue = Number.NEGATIVE_INFINITY;
  let peakX = 0;
  let peakY = 0;
  let nonFiniteSamples = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixels[(y * width + x) * RGBA_COMPONENTS + channel];
      if (!Number.isFinite(value)) {
        nonFiniteSamples += 1;
        continue;
      }
      signedEnergy += value;
      if (value >= 0) {
        positiveEnergy += value;
        weightedX += x * value;
        weightedY += y * value;
      } else {
        negativeEnergy -= value;
      }
      if (value > peakValue) {
        peakValue = value;
        peakX = x;
        peakY = y;
      }
    }
  }

  if (peakValue === Number.NEGATIVE_INFINITY) peakValue = 0;
  if (positiveEnergy <= 0) {
    return {
      channel,
      signedEnergy,
      positiveEnergy,
      negativeEnergy,
      peak: { value: peakValue, x: peakX, y: peakY },
      centroid: null,
      centroidOffsetPx: null,
      rmsRadiusPx: null,
      nonFiniteSamples,
    };
  }

  const centroid = [weightedX / positiveEnergy, weightedY / positiveEnergy] as const;
  let radialSecondMoment = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixels[(y * width + x) * RGBA_COMPONENTS + channel];
      if (!Number.isFinite(value) || value <= 0) continue;
      const dx = x - centroid[0];
      const dy = y - centroid[1];
      radialSecondMoment += (dx * dx + dy * dy) * value;
    }
  }

  return {
    channel,
    signedEnergy,
    positiveEnergy,
    negativeEnergy,
    peak: { value: peakValue, x: peakX, y: peakY },
    centroid,
    centroidOffsetPx: [
      centroid[0] - expectedCenter[0],
      centroid[1] - expectedCenter[1],
    ],
    rmsRadiusPx: Math.sqrt(radialSecondMoment / positiveEnergy),
    nonFiniteSamples,
  };
}

function createImpulseShader(
  center: readonly [number, number],
  value: readonly [number, number, number, number]
): string {
  return /* wgsl */ `
@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let texel = vec2u(position.xy);
  if (all(texel == vec2u(${center[0]}u, ${center[1]}u))) {
    return vec4f(${value.map(formatWgslFloat).join(', ')});
  }
  return vec4f(0.0);
}
`;
}

function normalizeProbeSize(size: readonly [number, number]): readonly [number, number] {
  return [assertDimension(size[0], 'width'), assertDimension(size[1], 'height')];
}

function normalizeProbeValue(
  value: readonly [number, number, number, number]
): readonly [number, number, number, number] {
  return [
    assertHalfFloat(value[0]),
    assertHalfFloat(value[1]),
    assertHalfFloat(value[2]),
    assertHalfFloat(value[3]),
  ];
}

function assertHalfFloat(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > HALF_FLOAT_MAX) {
    throw new Error(`VGPU impulse 半浮点分量无效：${value}`);
  }
  return value;
}

function assertDimension(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 2_048) {
    throw new Error(`VGPU impulse ${name} 必须是 1–2048 的整数，实际为 ${value}`);
  }
  return value;
}

function assertCoordinate(
  value: readonly [number, number],
  width: number,
  height: number
): readonly [number, number] {
  if (
    !Number.isFinite(value[0])
    || !Number.isFinite(value[1])
    || value[0] < 0
    || value[0] > width - 1
    || value[1] < 0
    || value[1] > height - 1
  ) {
    throw new Error(`VGPU impulse 预期质心越界：${value[0]}, ${value[1]}`);
  }
  return value;
}

function assertIntegerCoordinate(
  value: readonly [number, number],
  width: number,
  height: number
): readonly [number, number] {
  if (!Number.isInteger(value[0]) || !Number.isInteger(value[1])) {
    throw new Error(`VGPU impulse 像素坐标必须是整数：${value[0]}, ${value[1]}`);
  }
  return assertCoordinate(value, width, height);
}

function formatWgslFloat(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`;
  return String(value);
}

function destroyTarget(value: Target): void {
  (value as Target & { destroy(): void }).destroy();
}
