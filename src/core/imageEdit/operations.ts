import { parseMarkItems, sanitizeMarkCrop, sanitizeMarkOrientation } from './markCodec';
import {
  IMAGE_EDIT_OPERATION_IDS,
  createEmptyMarkOrientation,
  type AnnotationOperationParams,
  type CropOperationParams,
  type DiffusionDensity,
  type DiffusionMode,
  type DiffusionOperationParams,
  type DiffusionQuality,
  type ImageEditDocument,
  type ImageEditOperation,
  type OrientationOperationParams,
} from './types';

export type ImageEditOperationStage = 'geometry' | 'annotation' | 'effect' | 'output';

export interface ImageEditOperationDefinition<TParams extends object = object> {
  id: string;
  stage: ImageEditOperationStage;
  order: number;
  supportsMultiple: boolean;
  createDefaultParams: () => TParams;
  parseParams: (value: unknown) => TParams;
  /** 判断一个已校验操作是否仍然会改变图像。 */
  hasEffect?: (params: TParams) => boolean;
}

export class ImageEditOperationRegistrationError extends Error {}
export class UnsupportedImageEditOperationError extends Error {}
export class InvalidImageEditOperationParamsError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseOrientationParams(value: unknown): OrientationOperationParams {
  if (!isRecord(value)) throw new InvalidImageEditOperationParamsError('朝向参数必须是对象');
  const orientation = sanitizeMarkOrientation(value);
  if (orientation.rotate !== value.rotate || orientation.mirrored !== value.mirrored) {
    throw new InvalidImageEditOperationParamsError('朝向参数无效');
  }
  return orientation;
}

function parseAnnotationParams(value: unknown): AnnotationOperationParams {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new InvalidImageEditOperationParamsError('标注参数必须包含 items');
  const items = parseMarkItems(value.items);
  if (items.length !== value.items.length) throw new InvalidImageEditOperationParamsError('标注参数包含无效项目');
  return { items };
}

function parseCropParams(value: unknown): CropOperationParams {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'rect')) throw new InvalidImageEditOperationParamsError('裁剪参数必须包含 rect');
  if (value.rect === null) return { rect: null };
  const rect = sanitizeMarkCrop(value.rect);
  if (!rect) throw new InvalidImageEditOperationParamsError('裁剪区域无效');
  return { rect };
}

const DIFFUSION_MODES: DiffusionMode[] = ['black_mist', 'white_mist', 'glow'];
const DIFFUSION_DENSITIES: DiffusionDensity[] = ['1/8', '1/4', '1/2', '1'];
const DIFFUSION_QUALITIES: DiffusionQuality[] = ['realtime', 'high'];

function readFiniteRange(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new InvalidImageEditOperationParamsError(`柔光参数无效：${key}`);
  }
  return value;
}

function readEnum<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = record[key];
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new InvalidImageEditOperationParamsError(`柔光参数无效：${key}`);
  }
  return value as T;
}

function readDiffusionGroup(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new InvalidImageEditOperationParamsError(`柔光参数缺少分组：${key}`);
  }
  return value;
}

export function createDefaultDiffusionOperationParams(): DiffusionOperationParams {
  return {
    schemaVersion: 1,
    mode: 'black_mist',
    presetId: null,
    strength: 0.35,
    density: '1/4',
    source: {
      thresholdEV: 1.8,
      softKneeEV: 0.8,
      power: 1.2,
      highlightRecovery: 0.25,
    },
    scatter: {
      highlightAmount: 0.12,
      microAmount: 0.018,
      nearRadius: 0.003,
      farRadius: 0.045,
      tailAmount: 0.06,
      tailShape: 2.4,
      anisotropy: 0,
      angle: 0,
      chromaticSpread: 0.002,
    },
    tone: {
      veil: 0.012,
      blackRetention: 0.92,
      highlightCompression: 0.08,
      scatterDesaturation: 0.04,
    },
    detail: {
      highFrequencyRetention: 0.94,
      midFrequencyRetention: 0.99,
    },
    lens: {
      focalLengthEq: 50,
      aperture: 2.8,
      positionVariation: 0,
    },
    quality: 'realtime',
  };
}

export function parseDiffusionOperationParams(value: unknown): DiffusionOperationParams {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new InvalidImageEditOperationParamsError('柔光参数版本无效');
  }
  const source = readDiffusionGroup(value, 'source');
  const scatter = readDiffusionGroup(value, 'scatter');
  const tone = readDiffusionGroup(value, 'tone');
  const detail = readDiffusionGroup(value, 'detail');
  const lens = readDiffusionGroup(value, 'lens');
  const nearRadius = readFiniteRange(scatter, 'nearRadius', 0, 1);
  const farRadius = readFiniteRange(scatter, 'farRadius', 0, 1);
  if (nearRadius > farRadius) {
    throw new InvalidImageEditOperationParamsError('柔光近距半径不能大于远距半径');
  }
  const rawPresetId = value.presetId;
  if (rawPresetId !== null && typeof rawPresetId !== 'string') {
    throw new InvalidImageEditOperationParamsError('柔光预设 ID 无效');
  }
  const presetId = rawPresetId as string | null;
  return {
    schemaVersion: 1,
    mode: readEnum(value, 'mode', DIFFUSION_MODES),
    presetId,
    strength: readFiniteRange(value, 'strength', 0, 1),
    density: readEnum(value, 'density', DIFFUSION_DENSITIES),
    source: {
      thresholdEV: readFiniteRange(source, 'thresholdEV', -8, 8),
      softKneeEV: readFiniteRange(source, 'softKneeEV', 0, 8),
      power: readFiniteRange(source, 'power', 0.1, 8),
      highlightRecovery: readFiniteRange(source, 'highlightRecovery', 0, 1),
    },
    scatter: {
      highlightAmount: readFiniteRange(scatter, 'highlightAmount', 0, 1),
      microAmount: readFiniteRange(scatter, 'microAmount', 0, 1),
      nearRadius,
      farRadius,
      tailAmount: readFiniteRange(scatter, 'tailAmount', 0, 1),
      tailShape: readFiniteRange(scatter, 'tailShape', 1, 16),
      anisotropy: readFiniteRange(scatter, 'anisotropy', 0, 1),
      angle: readFiniteRange(scatter, 'angle', -360, 360),
      chromaticSpread: readFiniteRange(scatter, 'chromaticSpread', 0, 0.25),
    },
    tone: {
      veil: readFiniteRange(tone, 'veil', 0, 1),
      blackRetention: readFiniteRange(tone, 'blackRetention', 0, 1),
      highlightCompression: readFiniteRange(tone, 'highlightCompression', 0, 1),
      scatterDesaturation: readFiniteRange(tone, 'scatterDesaturation', 0, 1),
    },
    detail: {
      highFrequencyRetention: readFiniteRange(detail, 'highFrequencyRetention', 0, 1),
      midFrequencyRetention: readFiniteRange(detail, 'midFrequencyRetention', 0, 1),
    },
    lens: {
      focalLengthEq: readFiniteRange(lens, 'focalLengthEq', 1, 1000),
      aperture: readFiniteRange(lens, 'aperture', 0.1, 64),
      positionVariation: readFiniteRange(lens, 'positionVariation', 0, 1),
    },
    quality: readEnum(value, 'quality', DIFFUSION_QUALITIES),
  };
}

export function hasDiffusionEffect(params: DiffusionOperationParams): boolean {
  return params.strength > 0 && (
    params.scatter.highlightAmount > 0
    || params.scatter.microAmount > 0
    || params.tone.veil > 0
    || params.source.highlightRecovery > 0
  );
}

export class ImageEditOperationRegistry {
  private readonly definitions = new Map<string, ImageEditOperationDefinition>();

  register<TParams extends object>(definition: ImageEditOperationDefinition<TParams>): void {
    if (this.definitions.has(definition.id)) {
      throw new ImageEditOperationRegistrationError(`图片操作已注册：${definition.id}`);
    }
    this.definitions.set(definition.id, definition as unknown as ImageEditOperationDefinition);
  }

  get(operationId: string): ImageEditOperationDefinition | null {
    return this.definitions.get(operationId) ?? null;
  }

  list(): ImageEditOperationDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.order - right.order);
  }

  validateOperation(operation: ImageEditOperation): ImageEditOperation {
    const definition = this.get(operation.operationId);
    if (!definition) throw new UnsupportedImageEditOperationError(`不支持的图片操作：${operation.operationId}`);
    return { ...operation, params: definition.parseParams(operation.params) };
  }

  validateDocument(document: ImageEditDocument): ImageEditDocument {
    const counts = new Map<string, number>();
    const operations = document.operations.map((operation) => {
      const definition = this.get(operation.operationId);
      if (!definition) throw new UnsupportedImageEditOperationError(`不支持的图片操作：${operation.operationId}`);
      const count = (counts.get(operation.operationId) ?? 0) + 1;
      counts.set(operation.operationId, count);
      if (!definition.supportsMultiple && count > 1) {
        throw new InvalidImageEditOperationParamsError(`图片操作不允许重复：${operation.operationId}`);
      }
      return this.validateOperation(operation);
    });
    return { ...document, operations };
  }
}

export function createBuiltInImageEditOperationRegistry(): ImageEditOperationRegistry {
  const registry = new ImageEditOperationRegistry();
  registry.register<OrientationOperationParams>({
    id: IMAGE_EDIT_OPERATION_IDS.orientation,
    stage: 'geometry',
    order: 100,
    supportsMultiple: false,
    createDefaultParams: createEmptyMarkOrientation,
    parseParams: parseOrientationParams,
    hasEffect: (params) => params.rotate !== 0 || params.mirrored,
  });
  registry.register<AnnotationOperationParams>({
    id: IMAGE_EDIT_OPERATION_IDS.annotations,
    stage: 'annotation',
    order: 200,
    supportsMultiple: false,
    createDefaultParams: () => ({ items: [] }),
    parseParams: parseAnnotationParams,
    hasEffect: (params) => params.items.length > 0,
  });
  registry.register<CropOperationParams>({
    id: IMAGE_EDIT_OPERATION_IDS.crop,
    stage: 'geometry',
    order: 300,
    supportsMultiple: false,
    createDefaultParams: () => ({ rect: null }),
    parseParams: parseCropParams,
    hasEffect: (params) => params.rect !== null,
  });
  registry.register<DiffusionOperationParams>({
    id: IMAGE_EDIT_OPERATION_IDS.diffusion,
    stage: 'effect',
    order: 150,
    supportsMultiple: false,
    createDefaultParams: createDefaultDiffusionOperationParams,
    parseParams: parseDiffusionOperationParams,
    hasEffect: hasDiffusionEffect,
  });
  return registry;
}

export const imageEditOperationRegistry = createBuiltInImageEditOperationRegistry();
