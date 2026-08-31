import type {
  ImageEditAdmissionResult,
  ImageEditMemoryCategory,
  ImageEditMemoryLease,
  ImageEditResourceBudget,
} from '@/core/imageEdit/v3/resourceBudget'

export type ImageEditorResourcePressureRecoveryV3 =
  | 'lower-mip'
  | 'fallback-managed-preview'

export class ImageEditorResourcePressureErrorV3 extends Error {
  readonly code = 'image-editor-v3-resource-pressure'

  constructor(
    readonly scope: 'managed-preview' | 'viewport-composite',
    readonly category: ImageEditMemoryCategory,
    readonly requestedBytes: number,
    readonly availableBytes: number,
    readonly recovery: ImageEditorResourcePressureRecoveryV3,
  ) {
    const action = recovery === 'lower-mip'
      ? '请降低预览 mip/尺寸后重试'
      : '请回退到全局受管预览'
    super(`图片编辑资源预算不足（需要 ${requestedBytes} 字节，可用 ${availableBytes} 字节），${action}`)
    this.name = 'ImageEditorResourcePressureErrorV3'
  }
}

export function createImageEditorResourcePressureErrorV3(
  scope: ImageEditorResourcePressureErrorV3['scope'],
  category: ImageEditMemoryCategory,
  requestedBytes: number,
  admission: ImageEditAdmissionResult,
  recovery: ImageEditorResourcePressureRecoveryV3,
): ImageEditorResourcePressureErrorV3 {
  return new ImageEditorResourcePressureErrorV3(
    scope,
    category,
    requestedBytes,
    admission.availableBytes,
    recovery,
  )
}

export function acquireImageEditorResourceLeaseV3(
  budget: ImageEditResourceBudget,
  scope: ImageEditorResourcePressureErrorV3['scope'],
  category: ImageEditMemoryCategory,
  bytes: number,
  recovery: ImageEditorResourcePressureRecoveryV3,
): ImageEditMemoryLease {
  const admission = budget.admission(category, bytes)
  const lease = admission.admitted ? budget.acquire(category, bytes) : null
  if (lease) return lease
  throw createImageEditorResourcePressureErrorV3(
    scope,
    category,
    bytes,
    admission,
    recovery,
  )
}
