import { IMAGE_EDITOR_GLOW_TINT_HEX } from '@/core/theme/colorTokens';

export type VgpuGlowLook = 'natural' | 'dreamy' | 'neon';

export interface VgpuGlowOperationParams {
  schemaVersion: 2;
  look: VgpuGlowLook;
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
    schemaVersion: 2,
    look: 'natural',
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.natural,
    intensity: 0.48,
    radius: 0.34,
    chromaticAberration: 0,
    sourceThreshold: 0.42,
    whiteHeat: 0.38,
  },
  dreamy: {
    schemaVersion: 2,
    look: 'dreamy',
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.dreamy,
    intensity: 0.68,
    radius: 0.68,
    chromaticAberration: 0.08,
    sourceThreshold: 0.3,
    whiteHeat: 0.62,
  },
  neon: {
    schemaVersion: 2,
    look: 'neon',
    tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
    intensity: 0.82,
    radius: 0.46,
    chromaticAberration: 0.24,
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
  if (value.schemaVersion === 1) return migrateV1(value);
  if (value.schemaVersion !== 2) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 参数版本无效');
  if (!isVgpuGlowLook(value.look)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 光感无效');
  return {
    schemaVersion: 2,
    look: value.look,
    tintColor: parseHexColor(value.tintColor, '辉光颜色'),
    intensity: parseUnit(value.intensity, '辉光强度'),
    radius: parseUnit(value.radius, '发光半径'),
    chromaticAberration: parseUnit(value.chromaticAberration, '色差'),
    sourceThreshold: parseUnit(value.sourceThreshold, '亮源门槛'),
    whiteHeat: parseUnit(value.whiteHeat, '核心白热'),
  };
}

function migrateV1(value: Record<string, unknown>): VgpuGlowOperationParams {
  if (!isVgpuGlowLook(value.look)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 光感无效');
  const defaults = PRESETS[value.look];
  return {
    schemaVersion: 2,
    look: value.look,
    tintColor: defaults.tintColor,
    intensity: parseUnit(value.intensity, '辉光强度'),
    radius: parseUnit(value.spread, '辉光范围'),
    chromaticAberration: defaults.chromaticAberration,
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

function parseHexColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new InvalidVgpuGlowOperationParamsError(`${label}必须是六位十六进制颜色`);
  }
  return value.toLowerCase();
}
