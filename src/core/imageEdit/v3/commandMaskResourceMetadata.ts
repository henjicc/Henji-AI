import type {
  ImageEditLayerSetMaskCommandV3,
  ImageEditMaskResourceDescriptorV3,
} from './commandTypes';
import {
  collectImageEditMaskResourceIdsV3,
  type ImageEditMaskReferenceV3,
} from './layerTypes';

export class ImageEditMaskResourceMetadataErrorV3 extends Error {}

export interface ImageEditSetMaskResourceMetadataV3 {
  maskResources: ImageEditMaskResourceDescriptorV3[];
  previousMaskResources: ImageEditMaskResourceDescriptorV3[];
}

function fail(message: string): never {
  throw new ImageEditMaskResourceMetadataErrorV3(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 严格解析 set-mask 资源描述；资源必须唯一排序，且非空资源字节数必须大于零。 */
export function decodeImageEditMaskResourceDescriptorsV3(
  value: unknown,
  label: string,
): ImageEditMaskResourceDescriptorV3[] {
  if (!Array.isArray(value) || value.length > 100_000) fail(`${label}无效`);
  const output = value.map((entry) => {
    if (!isRecord(entry)
      || Object.keys(entry).length !== 2
      || !Object.hasOwn(entry, 'resourceId')
      || !Object.hasOwn(entry, 'byteSize')
      || typeof entry.resourceId !== 'string'
      || entry.resourceId.length === 0
      || entry.resourceId.length > 512
      || !Number.isSafeInteger(entry.byteSize)
      || Number(entry.byteSize) <= 0) fail(`${label}资源元数据无效`);
    return { resourceId: entry.resourceId, byteSize: Number(entry.byteSize) };
  });
  if (output.some((entry, index) => (
    index > 0 && output[index - 1].resourceId >= entry.resourceId
  ))) fail(`${label}未按资源 ID 唯一排序`);
  return output;
}

export function decodeImageEditMaskResourceDescriptorsForMaskV3(
  value: unknown,
  mask: ImageEditMaskReferenceV3 | null,
  label: string,
): ImageEditMaskResourceDescriptorV3[] {
  const descriptors = decodeImageEditMaskResourceDescriptorsV3(value, label);
  const expectedIds = mask ? collectImageEditMaskResourceIdsV3(mask).sort() : [];
  if (descriptors.length !== expectedIds.length
    || descriptors.some((entry, index) => entry.resourceId !== expectedIds[index])) {
    fail(`${label}与蒙版资源不一致`);
  }
  return descriptors;
}

export function decodeImageEditLayerSetMaskResourceMetadataV3(
  command: ImageEditLayerSetMaskCommandV3,
  previousMask: ImageEditMaskReferenceV3 | null,
): ImageEditSetMaskResourceMetadataV3 | null {
  const hasMetadata = command.maskResources !== undefined
    || command.previousMaskResources !== undefined;
  if (!hasMetadata) return null;
  if (command.maskResources === undefined || command.previousMaskResources === undefined) {
    fail('蒙版资源元数据必须成对提供');
  }
  return {
    maskResources: decodeImageEditMaskResourceDescriptorsForMaskV3(
      command.maskResources,
      command.mask,
      '新蒙版资源元数据',
    ),
    previousMaskResources: decodeImageEditMaskResourceDescriptorsForMaskV3(
      command.previousMaskResources,
      previousMask,
      '原蒙版资源元数据',
    ),
  };
}

export function invertImageEditSetMaskResourceMetadataV3(
  metadata: ImageEditSetMaskResourceMetadataV3 | null,
): Partial<Pick<
  ImageEditLayerSetMaskCommandV3,
  'maskResources' | 'previousMaskResources'
>> {
  return metadata ? {
    maskResources: metadata.previousMaskResources.map((entry) => ({ ...entry })),
    previousMaskResources: metadata.maskResources.map((entry) => ({ ...entry })),
  } : {};
}
