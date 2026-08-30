import { IMAGE_EDITOR_GLOW_TINT_HEX } from '@/core/theme/colorTokens';

export type VgpuGlowLook = 'natural' | 'dreamy' | 'neon';
export type VgpuGlowChromaticChannel = 'red' | 'green' | 'blue';
export type VgpuGlowChromaticChannels = readonly [
  VgpuGlowChromaticChannel,
  VgpuGlowChromaticChannel,
];

export interface VgpuGlowOperationParams {
  schemaVersion: 4;
  look: VgpuGlowLook;
  /** 是否用自定义颜色替代光源原本的颜色。 */
  tintEnabled: boolean;
  /** 辉光颜色。只改变散射光，不给原图整体染色。 */
  tintColor: string;
  /** 整体辉光能量 0..1。 */
  intensity: number;
  /** 辉光在图片空间中的扩散半径 0..1。 */
  radius: number;
  /** 两条所选通道的柔性水平光谱分离 0..1；0 表示关闭。 */
  chromaticAberration: number;
  /** 左、右两侧的有序色差色光；两项必须不同。 */
  chromaticChannels: VgpuGlowChromaticChannels;
  /** 参与发光的亮源门槛 0..1。 */
  sourceThreshold: number;
  /** 过曝核心向白色靠拢的程度 0..1。 */
  whiteHeat: number;
}

export class InvalidVgpuGlowOperationParamsError extends Error {}

const PRESETS: Readonly<Record<VgpuGlowLook, VgpuGlowOperationParams>> = {
  natural: {
    schemaVersion: 4,
    look: 'natural',
    tintEnabled: false,
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.natural,
    intensity: 0.48,
    radius: 0.34,
    chromaticAberration: 0,
    chromaticChannels: ['red', 'blue'],
    sourceThreshold: 0.42,
    whiteHeat: 0.38,
  },
  dreamy: {
    schemaVersion: 4,
    look: 'dreamy',
    tintEnabled: false,
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.dreamy,
    intensity: 0.68,
    radius: 0.68,
    chromaticAberration: 0,
    chromaticChannels: ['red', 'blue'],
    sourceThreshold: 0.3,
    whiteHeat: 0.62,
  },
  neon: {
    schemaVersion: 4,
    look: 'neon',
    tintEnabled: false,
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
    intensity: 0.82,
    radius: 0.46,
    chromaticAberration: 0,
    chromaticChannels: ['red', 'blue'],
    sourceThreshold: 0.34,
    whiteHeat: 0.82,
  },
};

export function createDefaultVgpuGlowOperationParams(): VgpuGlowOperationParams {
  return { ...PRESETS.dreamy };
}

export function applyVgpuGlowLook(look: VgpuGlowLook): VgpuGlowOperationParams {
  return { ...PRESETS[look] };
}

export function hasVgpuGlowEffect(params: VgpuGlowOperationParams): boolean {
  return params.intensity > 0;
}

/**
 * 替换一侧色光；如果新颜色已被另一侧占用，则原子交换两侧，避免产生无效同色状态。
 */
export function replaceVgpuGlowChromaticChannel(
  channels: VgpuGlowChromaticChannels,
  index: 0 | 1,
  channel: VgpuGlowChromaticChannel
): VgpuGlowChromaticChannels {
  if (channels[index] === channel) return channels;
  if (channels[index === 0 ? 1 : 0] === channel) return [channels[1], channels[0]];
  return index === 0 ? [channel, channels[1]] : [channels[0], channel];
}

export function parseVgpuGlowOperationParams(value: unknown): VgpuGlowOperationParams {
  if (!isRecord(value)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 参数必须是对象');
  if (value.schemaVersion !== 4) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 参数版本无效');
  if (!isVgpuGlowLook(value.look)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 光感无效');
  return {
    schemaVersion: 4,
    look: value.look,
    tintEnabled: parseBoolean(value.tintEnabled, '辉光着色开关'),
    tintColor: parseHexColor(value.tintColor, '辉光颜色'),
    intensity: parseUnit(value.intensity, '辉光强度'),
    radius: parseUnit(value.radius, '发光半径'),
    chromaticAberration: parseUnit(value.chromaticAberration, '色差'),
    chromaticChannels: parseChromaticChannels(value.chromaticChannels),
    sourceThreshold: parseUnit(value.sourceThreshold, '亮源门槛'),
    whiteHeat: parseUnit(value.whiteHeat, '核心白热'),
  };
}

function isVgpuGlowLook(value: unknown): value is VgpuGlowLook {
  return value === 'natural' || value === 'dreamy' || value === 'neon';
}

function isVgpuGlowChromaticChannel(value: unknown): value is VgpuGlowChromaticChannel {
  return value === 'red' || value === 'green' || value === 'blue';
}

function parseChromaticChannels(value: unknown): VgpuGlowChromaticChannels {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || !isVgpuGlowChromaticChannel(value[0])
    || !isVgpuGlowChromaticChannel(value[1])
    || value[0] === value[1]
  ) {
    throw new InvalidVgpuGlowOperationParamsError('色差颜色必须是两种不同的 RGB 通道');
  }
  return [value[0], value[1]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseUnit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidVgpuGlowOperationParamsError(`${label}必须在 0～1 之间`);
  }
  return value;
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new InvalidVgpuGlowOperationParamsError(`${label}必须是布尔值`);
  }
  return value;
}

function parseHexColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new InvalidVgpuGlowOperationParamsError(`${label}必须是六位十六进制颜色`);
  }
  return value.toLowerCase();
}
