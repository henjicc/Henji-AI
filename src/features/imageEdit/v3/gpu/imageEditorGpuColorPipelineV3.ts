import {
  IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  type ImageEditColorModeV3,
  type ImageEditTransferFunctionV3,
} from '@/core/imageEdit/v3/colorTypes'
import {
  linearWorkingSpaceMatrixV3,
  type ImageEditColorMatrix3V3,
} from '@/core/imageEdit/v3/execution/tileColor'

export const IMAGE_EDITOR_GPU_TRANSFER_CODE_V3 = {
  linear: 0,
  srgb: 1,
  pq: 2,
  hlg: 3,
} as const satisfies Record<ImageEditTransferFunctionV3, number>

export interface ImageEditorGpuSourceColorUniformV3 {
  readonly transferCode: number
  readonly referenceWhiteNits: number
  readonly sourceToWorking: ImageEditColorMatrix3V3
}

export interface ImageEditorGpuPresentColorUniformV3 {
  readonly workingToSrgb: ImageEditColorMatrix3V3
  readonly toneMapToSdr: boolean
}

/** 源 provider 已将 ICC/CICP 解码为 sRGB/scRGB 原色；GPU 从该明确边界转入文档工作空间。 */
export function imageEditorGpuSourceColorUniformV3(
  source: { colorSpace: 'srgb' | 'scrgb'; transferFunction: 'srgb' | 'linear' },
  documentColor: ImageEditColorModeV3,
): ImageEditorGpuSourceColorUniformV3 {
  return {
    transferCode: IMAGE_EDITOR_GPU_TRANSFER_CODE_V3[source.transferFunction],
    referenceWhiteNits: documentColor.hdrMetadata?.referenceWhiteNits
      ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
    sourceToWorking: linearWorkingSpaceMatrixV3('srgb', documentColor.workingSpace),
  }
}

export function imageEditorGpuPresentColorUniformV3(
  documentColor: ImageEditColorModeV3,
): ImageEditorGpuPresentColorUniformV3 {
  return {
    workingToSrgb: linearWorkingSpaceMatrixV3(documentColor.workingSpace, 'srgb'),
    toneMapToSdr: documentColor.hdrMetadata !== null
      || documentColor.transferFunction === 'pq'
      || documentColor.transferFunction === 'hlg',
  }
}

export function packImageEditorGpuColorMatrixRowsV3(
  matrix: ImageEditColorMatrix3V3,
): readonly [number, number, number, number, number, number, number, number, number, number, number, number] {
  return [
    matrix[0], matrix[1], matrix[2], 0,
    matrix[3], matrix[4], matrix[5], 0,
    matrix[6], matrix[7], matrix[8], 0,
  ]
}

export function applyImageEditorGpuColorMatrixForTestV3(
  matrix: ImageEditColorMatrix3V3,
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    matrix[0] * value[0] + matrix[1] * value[1] + matrix[2] * value[2],
    matrix[3] * value[0] + matrix[4] * value[1] + matrix[5] * value[2],
    matrix[6] * value[0] + matrix[7] * value[1] + matrix[8] * value[2],
  ]
}
