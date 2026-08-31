import { IMAGE_EDIT_MASK_TILE_SIZE_V3 } from './layerTypes';

const MASK_ID_MAX_LENGTH = 512;
const MASK_TILE_KEY_MAX_LENGTH = 128;
const MASK_TILE_LIMIT = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown, maxLength = MASK_ID_MAX_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/** 返回严格历史快照中的蒙版错误；null 表示可继续交给文档 codec 做内容校验。 */
export function getImageEditHistoryMaskValidationErrorV3(
  value: unknown,
  label: string,
): string | null {
  if (!isRecord(value)) return `${label}无效`;
  if (value.kind === 'sparse-mask') {
    if (!hasExactKeys(value, [
      'kind', 'storage', 'maskId', 'tileSize', 'defaultValue', 'tiles', 'inverted',
    ])) return `${label}包含未知字段或缺少字段`;
    if (value.storage !== 'mask-float32' || value.tileSize !== IMAGE_EDIT_MASK_TILE_SIZE_V3) {
      return `${label}存储契约无效`;
    }
    if (value.defaultValue !== 0 && value.defaultValue !== 1) return `${label}默认值无效`;
    if (!isNonEmptyString(value.maskId)) return `${label} ID无效`;
    if (!isRecord(value.tiles) || Object.keys(value.tiles).length > MASK_TILE_LIMIT) {
      return `${label}瓦片无效`;
    }
    for (const [tileKey, resourceId] of Object.entries(value.tiles)) {
      if (!isNonEmptyString(tileKey, MASK_TILE_KEY_MAX_LENGTH)) return `${label}瓦片键无效`;
      if (!isNonEmptyString(resourceId)) return `${label}瓦片资源 ID无效`;
    }
  } else {
    if (!hasExactKeys(value, ['resourceId', 'inverted'])) {
      return `${label}包含未知字段或缺少字段`;
    }
    if (!isNonEmptyString(value.resourceId)) return `${label}资源 ID无效`;
  }
  return typeof value.inverted === 'boolean' ? null : `${label}反转值无效`;
}
