import { parseMarkItems, sanitizeMarkCrop, sanitizeMarkOrientation } from './markCodec';
import {
  createDefaultBlurOperationParams,
  hasBlurEffect,
  InvalidBlurOperationParamsError,
  parseBlurOperationParams as parseBlurParams,
  type BlurOperationParams,
} from './blurParams';
import {
  createDefaultDiffusionOperationParams,
  hasDiffusionEffect,
  InvalidDiffusionOperationParamsError,
  parseDiffusionOperationParams as parseDiffusionParams,
} from './diffusionParams';
import {
  createDefaultVgpuGlowOperationParams,
  hasVgpuGlowEffect,
  InvalidVgpuGlowOperationParamsError,
  parseVgpuGlowOperationParams as parseVgpuGlowParams,
  type VgpuGlowOperationParams,
} from './vgpuGlowParams';
export {
  createDefaultDiffusionOperationParams,
  hasDiffusionEffect,
} from './diffusionParams';
import {
  IMAGE_EDIT_OPERATION_IDS,
  createEmptyMarkOrientation,
  type AnnotationOperationParams,
  type CropOperationParams,
  type DiffusionOperationParams,
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

const IMAGE_EDIT_EXCLUSIVE_OPERATION_GROUPS: readonly (readonly string[])[] = [[
  IMAGE_EDIT_OPERATION_IDS.diffusion,
  IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
]];

/** 返回启用目标操作时必须关闭的同组操作；互斥关系只在这里声明。 */
export function getConflictingImageEditOperationIds(operationId: string): readonly string[] {
  const group = IMAGE_EDIT_EXCLUSIVE_OPERATION_GROUPS.find((ids) => ids.includes(operationId));
  return group?.filter((id) => id !== operationId) ?? [];
}

/** 找出文档中同时启用的第一对互斥操作，供执行边界做防御性校验。 */
export function findImageEditOperationExclusivityConflict(
  document: ImageEditDocument
): readonly [string, string] | null {
  for (const group of IMAGE_EDIT_EXCLUSIVE_OPERATION_GROUPS) {
    const enabled = group.filter((operationId) => document.operations.some(
      (operation) => operation.operationId === operationId && operation.enabled
    ));
    if (enabled.length > 1) return [enabled[0], enabled[1]];
  }
  return null;
}

export function parseDiffusionOperationParams(value: unknown): DiffusionOperationParams {
  try {
    return parseDiffusionParams(value);
  } catch (error) {
    if (error instanceof InvalidDiffusionOperationParamsError) {
      throw new InvalidImageEditOperationParamsError(error.message);
    }
    throw error;
  }
}

export function parseBlurOperationParams(value: unknown): BlurOperationParams {
  try {
    return parseBlurParams(value);
  } catch (error) {
    if (error instanceof InvalidBlurOperationParamsError) {
      throw new InvalidImageEditOperationParamsError(error.message);
    }
    throw error;
  }
}

export function parseVgpuGlowOperationParams(value: unknown): VgpuGlowOperationParams {
  try {
    return parseVgpuGlowParams(value);
  } catch (error) {
    if (error instanceof InvalidVgpuGlowOperationParamsError) {
      throw new InvalidImageEditOperationParamsError(error.message);
    }
    throw error;
  }
}

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
    const validated = { ...document, operations };
    const conflict = findImageEditOperationExclusivityConflict(validated);
    if (conflict) {
      throw new InvalidImageEditOperationParamsError(
        `图片光效不能同时启用：${conflict.join(' 与 ')}；请只启用其中一个。`
      );
    }
    return validated;
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
  registry.register<BlurOperationParams>({
    id: IMAGE_EDIT_OPERATION_IDS.blur,
    stage: 'effect',
    order: 140,
    supportsMultiple: false,
    createDefaultParams: createDefaultBlurOperationParams,
    parseParams: parseBlurOperationParams,
    hasEffect: hasBlurEffect,
  });
  registry.register<VgpuGlowOperationParams>({
    id: IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
    stage: 'effect',
    order: 160,
    supportsMultiple: false,
    createDefaultParams: createDefaultVgpuGlowOperationParams,
    parseParams: parseVgpuGlowOperationParams,
    hasEffect: hasVgpuGlowEffect,
  });
  return registry;
}

export const imageEditOperationRegistry = createBuiltInImageEditOperationRegistry();
