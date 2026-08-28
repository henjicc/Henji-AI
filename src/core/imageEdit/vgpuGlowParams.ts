import { IMAGE_EDITOR_GLOW_TINT_HEX } from '@/core/theme/colorTokens';

export type VgpuGlowLook = 'natural' | 'dreamy' | 'neon';

export interface VgpuGlowOperationParams {
  schemaVersion: 3;
  look: VgpuGlowLook;
  /** 是否用自定义颜色替代光源原本的颜色。 */
  tintEnabled: boolean;
  /** 辉光颜色。只改变散射光，不给原图整体染色。 */
  tintColor: string;
  /** 整体辉光能量 0..1。 */
  intensity: number;
  /** 辉光在图片空间中的扩散半径 0..1。 */
  radius: number;
  /** 各颜色通道的散射半径差异 0..1。 */
  chromaticAberration: number;
  /** 参与发光的亮源门槛 0..1。 */
  sourceThreshold: number;
  /** 过曝核心向白色靠拢的程度 0..1。 */
  whiteHeat: number;
}

export class InvalidVgpuGlowOperationParamsError extends Error {}

const PRESETS: Readonly<Record<VgpuGlowLook, VgpuGlowOperationParams>> = {
  natural: {
    schemaVersion: 3,
    look: 'natural',
    tintEnabled: false,
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.natural,
    intensity: 0.48,
    radius: 0.34,
    chromaticAberration: 0,
    sourceThreshold: 0.42,
    whiteHeat: 0.38,
  },
  dreamy: {
    schemaVersion: 3,
    look: 'dreamy',
    tintEnabled: false,
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.dreamy,
    intensity: 0.68,
    radius: 0.68,
    chromaticAberration: 0,
    sourceThreshold: 0.3,
    whiteHeat: 0.62,
  },
  neon: {
    schemaVersion: 3,
    look: 'neon',
    tintEnabled: false,
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
    intensity: 0.82,
    radius: 0.46,
    chromaticAberration: 0,
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

export function parseVgpuGlowOperationParams(value: unknown): VgpuGlowOperationParams {
  if (!isRecord(value)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 参数必须是对象');
  if (value.schemaVersion !== 3) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 参数版本无效');
  if (!isVgpuGlowLook(value.look)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 光感无效');
  return {
    schemaVersion: 3,
    look: value.look,
    tintEnabled: parseBoolean(value.tintEnabled, '辉光着色开关'),
    tintColor: parseHexColor(value.tintColor, '辉光颜色'),
    intensity: parseUnit(value.intensity, '辉光强度'),
    radius: parseUnit(value.radius, '发光半径'),
    chromaticAberration: parseUnit(value.chromaticAberration, '色差'),
    sourceThreshold: parseUnit(value.sourceThreshold, '亮源门槛'),
    whiteHeat: parseUnit(value.whiteHeat, '核心白热'),
  };
}

function isVgpuGlowLook(value: unknown): value is VgpuGlowLook {
  return value === 'natural' || value === 'dreamy' || value === 'neon';
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
