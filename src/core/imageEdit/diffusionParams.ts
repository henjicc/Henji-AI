import type {
  DiffusionDensity,
  DiffusionMode,
  DiffusionOperationParams,
  DiffusionQuality,
  DiffusionTintParams,
} from './types';

export class InvalidDiffusionOperationParamsError extends Error {}

const DIFFUSION_MODES: DiffusionMode[] = ['black_mist', 'white_mist', 'glow'];
const DIFFUSION_DENSITIES: DiffusionDensity[] = ['low', 'medium', 'high'];
const DIFFUSION_QUALITIES: DiffusionQuality[] = ['realtime', 'high'];

export const DIFFUSION_PARAMS_SCHEMA_VERSION = 3 as const;

export function createDefaultDiffusionTintParams(): DiffusionTintParams {
  return { enabled: false, hue: 210, saturation: 0.5, lightness: 0, coreWhite: 0.55 };
}

export function createDefaultDiffusionOperationParams(): DiffusionOperationParams {
  return {
    schemaVersion: DIFFUSION_PARAMS_SCHEMA_VERSION,
    mode: 'black_mist',
    density: 'medium',
    quality: 'realtime',
    strength: 0.35,
    glowRange: 0.35,
    highlightResponse: 0.45,
    softness: 0.3,
    blackRetention: 0.92,
    detailRetention: 0.9,
    colorRetention: 0.92,
    glowExposure: 0.5,
    highlightRolloff: 0.6,
    tint: createDefaultDiffusionTintParams(),
  };
}

export function parseDiffusionOperationParams(value: unknown): DiffusionOperationParams {
  if (!isRecord(value)) {
    throw new InvalidDiffusionOperationParamsError('柔光参数无效');
  }
  if (value.schemaVersion === 1) {
    return migrateFromV2(migrateFromV1(value));
  }
  if (value.schemaVersion === 2) {
    return migrateFromV2(readCommonFields(value));
  }
  if (value.schemaVersion !== DIFFUSION_PARAMS_SCHEMA_VERSION) {
    throw new InvalidDiffusionOperationParamsError('柔光参数版本无效');
  }
  return {
    ...readCommonFields(value),
    glowExposure: readUnit(value, 'glowExposure'),
    highlightRolloff: readUnit(value, 'highlightRolloff'),
    tint: { ...readTint(value), coreWhite: readFiniteRange(readTintRecord(value), 'coreWhite', 0, 1) },
  };
}

/** v2 与 v3 共有的字段。v3 新增项由调用方补齐，避免解析和迁移各写一份读取逻辑。 */
function readCommonFields(
  value: Record<string, unknown>
): Omit<DiffusionOperationParams, 'glowExposure' | 'highlightRolloff'> {
  return {
    schemaVersion: DIFFUSION_PARAMS_SCHEMA_VERSION,
    mode: readEnum(value, 'mode', DIFFUSION_MODES),
    density: readEnum(value, 'density', DIFFUSION_DENSITIES),
    quality: readEnum(value, 'quality', DIFFUSION_QUALITIES),
    strength: readUnit(value, 'strength'),
    glowRange: readUnit(value, 'glowRange'),
    highlightResponse: readUnit(value, 'highlightResponse'),
    softness: readUnit(value, 'softness'),
    blackRetention: readUnit(value, 'blackRetention'),
    detailRetention: readUnit(value, 'detailRetention'),
    colorRetention: readUnit(value, 'colorRetention'),
    tint: readTint(value),
  };
}

/**
 * v2 → v3 迁移。
 *
 * v2 的辉光靠 `headroom = 1 - 底图峰值` 做空间门控来防溢出，v3 改成线性相加 + 末端
 * 保色相肩部，因此同样的 strength 在 v3 下会明显更亮。这里不去反推等效强度：
 * 旧值对应的观感本身就是要修掉的那个（光源中心不发光），逐值还原没有意义。
 * 迁移只补齐新字段的中性默认值，让旧文档能打开。
 */
function migrateFromV2(
  value: Omit<DiffusionOperationParams, 'glowExposure' | 'highlightRolloff'>
): DiffusionOperationParams {
  const defaults = createDefaultDiffusionOperationParams();
  return {
    ...value,
    glowExposure: defaults.glowExposure,
    highlightRolloff: defaults.highlightRolloff,
    tint: { ...value.tint, coreWhite: defaults.tint.coreWhite },
  };
}

export function hasDiffusionEffect(params: DiffusionOperationParams): boolean {
  return params.strength > 0;
}

/**
 * v1 → v2 迁移。
 *
 * v1 把二十多个光学参数直接暴露给用户，v2 收敛成七个直观量，因此这里是**有损**的：
 * 各向异性、散射角度、色散、响应幂值、镜头组在 v2 中不复存在，直接丢弃；
 * 微扩散、雾幕、高光压缩改由 mode 派生，同样不再从旧值读取。
 * 迁移目标是让旧文档仍能打开且观感接近，不是逐参数等价还原。
 */
function migrateFromV1(value: Record<string, unknown>): DiffusionOperationParams {
  const defaults = createDefaultDiffusionOperationParams();
  const scatter = optionalGroup(value, 'scatter');
  const source = optionalGroup(value, 'source');
  const tone = optionalGroup(value, 'tone');
  const detail = optionalGroup(value, 'detail');

  const farRadius = optionalNumber(scatter, 'farRadius');
  const thresholdEV = optionalNumber(source, 'thresholdEV');
  const tailAmount = optionalNumber(scatter, 'tailAmount');
  const scatterDesaturation = optionalNumber(tone, 'scatterDesaturation');

  return {
    ...defaults,
    mode: isEnum(value.mode, DIFFUSION_MODES) ? value.mode : defaults.mode,
    density: migrateDensity(value.density),
    quality: isEnum(value.quality, DIFFUSION_QUALITIES) ? value.quality : defaults.quality,
    strength: clampUnit(optionalNumber(value, 'strength') ?? defaults.strength),
    // v1 半径域是 0..0.25 左右的归一化值，按上限 0.2 折回 0..1
    glowRange: farRadius === undefined ? defaults.glowRange : clampUnit(farRadius / 0.2),
    // v1 阈值 +4EV(只有最亮处) → 0，-1EV(几乎全画面) → 1
    highlightResponse: thresholdEV === undefined
      ? defaults.highlightResponse
      : clampUnit((4 - thresholdEV) / 5),
    softness: tailAmount === undefined ? defaults.softness : clampUnit(tailAmount / 0.35),
    blackRetention: clampUnit(optionalNumber(tone, 'blackRetention') ?? defaults.blackRetention),
    detailRetention: clampUnit(
      optionalNumber(detail, 'highFrequencyRetention') ?? defaults.detailRetention
    ),
    colorRetention: scatterDesaturation === undefined
      ? defaults.colorRetention
      : clampUnit(1 - scatterDesaturation),
    tint: createDefaultDiffusionTintParams(),
  };
}

function migrateDensity(value: unknown): DiffusionDensity {
  if (value === '1/8') return 'low';
  if (value === '1/2' || value === '1') return 'high';
  return 'medium';
}

function readTintRecord(value: Record<string, unknown>): Record<string, unknown> {
  const tint = value.tint;
  if (!isRecord(tint)) {
    throw new InvalidDiffusionOperationParamsError('柔光参数缺少分组：tint');
  }
  return tint;
}

/** 只读 v2 就有的着色字段；v3 新增的 coreWhite 由调用方决定是严格读取还是取默认值。 */
function readTint(value: Record<string, unknown>): DiffusionTintParams {
  const tint = readTintRecord(value);
  if (typeof tint.enabled !== 'boolean') {
    throw new InvalidDiffusionOperationParamsError('柔光参数无效：tint.enabled');
  }
  return {
    enabled: tint.enabled,
    hue: readFiniteRange(tint, 'hue', 0, 360),
    saturation: readFiniteRange(tint, 'saturation', 0, 1),
    lightness: readFiniteRange(tint, 'lightness', -1, 1),
    coreWhite: createDefaultDiffusionTintParams().coreWhite,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readUnit(record: Record<string, unknown>, key: string): number {
  return readFiniteRange(record, key, 0, 1);
}

function readFiniteRange(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new InvalidDiffusionOperationParamsError(`柔光参数无效：${key}`);
  }
  return value;
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = record[key];
  if (!isEnum(value, values)) {
    throw new InvalidDiffusionOperationParamsError(`柔光参数无效：${key}`);
  }
  return value;
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function optionalGroup(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
