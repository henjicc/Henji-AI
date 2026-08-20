export const IMAGE_BLUR_ALGORITHMS = [
  { id: 'gaussian', label: '高斯模糊' },
] as const;

export type ImageBlurAlgorithmId = typeof IMAGE_BLUR_ALGORITHMS[number]['id'];

export interface BlurOperationParams {
  schemaVersion: 1;
  algorithm: ImageBlurAlgorithmId;
  /** 归一化强度 0..1，由执行器按图片尺寸换算为半径。 */
  strength: number;
}

export const DEFAULT_IMAGE_BLUR_ALGORITHM: ImageBlurAlgorithmId = 'gaussian';

export class InvalidBlurOperationParamsError extends Error {}

export function createDefaultBlurOperationParams(): BlurOperationParams {
  return {
    schemaVersion: 1,
    algorithm: DEFAULT_IMAGE_BLUR_ALGORITHM,
    strength: 0.3,
  };
}

export function isImageBlurAlgorithmId(value: unknown): value is ImageBlurAlgorithmId {
  return IMAGE_BLUR_ALGORITHMS.some((algorithm) => algorithm.id === value);
}

export function parseBlurOperationParams(value: unknown): BlurOperationParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidBlurOperationParamsError('模糊参数必须是对象');
  }
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1) {
    throw new InvalidBlurOperationParamsError('不支持的模糊参数版本');
  }
  if (!isImageBlurAlgorithmId(source.algorithm)) {
    throw new InvalidBlurOperationParamsError('不支持的模糊算法');
  }
  if (
    typeof source.strength !== 'number'
    || !Number.isFinite(source.strength)
    || source.strength < 0
    || source.strength > 1
  ) {
    throw new InvalidBlurOperationParamsError('模糊强度必须在 0～1 之间');
  }
  return {
    schemaVersion: 1,
    algorithm: source.algorithm,
    strength: source.strength,
  };
}

export function hasBlurEffect(params: BlurOperationParams): boolean {
  return params.strength > 0;
}
