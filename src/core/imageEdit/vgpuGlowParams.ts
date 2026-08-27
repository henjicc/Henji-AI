export type VgpuGlowLook = 'natural' | 'dreamy' | 'neon';

export interface VgpuGlowOperationParams {
  schemaVersion: 1;
  look: VgpuGlowLook;
  /** 整体辉光能量 0..1。 */
  intensity: number;
  /** 近、中、远三层辉光的空间分配 0..1。 */
  spread: number;
  /** 参与发光的亮源门槛 0..1。 */
  sourceThreshold: number;
  /** 过曝核心向白色靠拢的程度 0..1。 */
  whiteHeat: number;
}

export class InvalidVgpuGlowOperationParamsError extends Error {}

const PRESETS: Readonly<Record<VgpuGlowLook, VgpuGlowOperationParams>> = {
  natural: {
    schemaVersion: 1,
    look: 'natural',
    intensity: 0.48,
    spread: 0.42,
    sourceThreshold: 0.58,
    whiteHeat: 0.38,
  },
  dreamy: {
    schemaVersion: 1,
    look: 'dreamy',
    intensity: 0.68,
    spread: 0.72,
    sourceThreshold: 0.38,
    whiteHeat: 0.62,
  },
  neon: {
    schemaVersion: 1,
    look: 'neon',
    intensity: 0.82,
    spread: 0.56,
    sourceThreshold: 0.5,
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
  if (value.schemaVersion !== 1) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 参数版本无效');
  if (!isVgpuGlowLook(value.look)) throw new InvalidVgpuGlowOperationParamsError('辉光 Pro 光感无效');
  return {
    schemaVersion: 1,
    look: value.look,
    intensity: parseUnit(value.intensity, '辉光强度'),
    spread: parseUnit(value.spread, '辉光范围'),
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
