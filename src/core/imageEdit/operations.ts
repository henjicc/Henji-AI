import { parseMarkItems, sanitizeMarkCrop, sanitizeMarkOrientation } from './markCodec';
import {
  createDefaultDiffusionOperationParams,
  hasDiffusionEffect,
  InvalidDiffusionOperationParamsError,
  parseDiffusionOperationParams as parseDiffusionParams,
} from './diffusionParams';
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
