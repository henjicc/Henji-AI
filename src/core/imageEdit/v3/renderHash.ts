export type ImageEditHashValue =
  | null
  | boolean
  | number
  | string
  | readonly ImageEditHashValue[]
  | { readonly [key: string]: ImageEditHashValue };

function stableSerialize(value: ImageEditHashValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as { readonly [key: string]: ImageEditHashValue };
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(record[key])}`
  )).join(',')}}`;
}

/** 快速稳定哈希只用于缓存身份，不作为资源内容的加密摘要。 */
export function createImageEditRenderHash(value: ImageEditHashValue): string {
  const text = stableSerialize(value);
  let high = 0x9e3779b9;
  let low = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low ^= code;
    low = Math.imul(low, 0x01000193) >>> 0;
    high ^= low + code + ((high << 6) >>> 0) + (high >>> 2);
    high >>>= 0;
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

export interface ImageEditTileCacheKeyParts {
  sourceFingerprint: string;
  subtreeHash: string;
  nodeVersion: number;
  parameterHash: string;
  mip: number;
  tileX: number;
  tileY: number;
  quality: string;
  backend: string;
  deviceGeneration: number;
  colorMode: string;
}

export function createImageEditTileCacheKey(parts: ImageEditTileCacheKeyParts): string {
  return createImageEditRenderHash({
    sourceFingerprint: parts.sourceFingerprint,
    subtreeHash: parts.subtreeHash,
    nodeVersion: parts.nodeVersion,
    parameterHash: parts.parameterHash,
    mip: parts.mip,
    tileX: parts.tileX,
    tileY: parts.tileY,
    quality: parts.quality,
    backend: parts.backend,
    deviceGeneration: parts.deviceGeneration,
    colorMode: parts.colorMode,
  });
}
