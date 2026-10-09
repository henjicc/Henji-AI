import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3DocumentSnapshot, ImageEditorV3ManagedSource } from '@/platform/contracts/imageEditorV3'
export const IMAGE_EDIT_TEST_SOURCE_REF = `sha256:${'a'.repeat(64)}` as const
export function imageEditTestManagedSource(width = 800, height = 600): ImageEditorV3ManagedSource {
  return { mediaUrl: `henji-media://image-editor-v3/${'a'.repeat(64)}`, resource: { resourceRef: IMAGE_EDIT_TEST_SOURCE_REF, byteLength: 4096, mediaType: 'image/png' }, metadata: {
    resourceRef: IMAGE_EDIT_TEST_SOURCE_REF, width, height, encodedWidth: width, encodedHeight: height,
    format: 'png', channels: 4, depth: 'uchar', bitsPerSample: 8, colorSpace: 'srgb', orientation: 1,
    orientationApplied: true, density: null, pages: 1, hasAlpha: true, hasIccProfile: false, iccProfileResourceRef: null, cicp: null, hdr: false,
  } }
}
export function imageEditTestSnapshot(document: ImageEditDocumentV3): ImageEditorV3DocumentSnapshot {
  return { documentRef: `image-edit-v3:${document.id}`, revision: document.revision, previewRef: null, document: structuredClone(document), history: null,
    resourceRefs: [IMAGE_EDIT_TEST_SOURCE_REF], resources: [imageEditTestManagedSource().resource], sourceFingerprint: `sha256:${'b'.repeat(64)}` }
}
