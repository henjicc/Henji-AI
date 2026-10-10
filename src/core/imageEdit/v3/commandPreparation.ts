import { applyImageEditCommandV3 } from './commandReducer';
import { collectPositiveImageEditCommandResourceBytesV3, prepareImageEditCommandResourceMetadataV3 } from './commandLayerResourceMetadata';
import type { ImageEditCommandV3, ImageEditLeafCommandV3 } from './commandTypes';
import type { ImageEditDocumentV3 } from './documentTypes';
/** Prepare each atomic leaf against its actual predecessor, using the one formal reducer. */
export function prepareImageEditCommandV3(document: ImageEditDocumentV3, command: ImageEditCommandV3, byteSizes: ReadonlyMap<string, number>): ImageEditCommandV3 {
  if (command.type !== 'document.atomic') return prepareImageEditCommandResourceMetadataV3(document, command, byteSizes);
  let candidate = document;
  const sizes = new Map(byteSizes), commands: ImageEditLeafCommandV3[] = [];
  for (const child of command.commands) {
    for (const descriptor of collectPositiveImageEditCommandResourceBytesV3(child)) {
      const existing = sizes.get(descriptor.resourceId);
      if (existing !== undefined && existing !== descriptor.byteSize) throw new Error('图片编辑资源字节数冲突');
      sizes.set(descriptor.resourceId, descriptor.byteSize);
    }
    const prepared = prepareImageEditCommandResourceMetadataV3(candidate, child, sizes) as ImageEditLeafCommandV3;
    candidate = applyImageEditCommandV3(candidate, { ...prepared, expectedRevision: candidate.revision }, { deferSmartConsistency: true }).document;
    commands.push(prepared);
  }
  return { ...command, commands };
}
