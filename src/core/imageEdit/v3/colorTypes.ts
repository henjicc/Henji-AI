/** 图片编辑 V3 的显式颜色管理契约。 */

export type ImageEditWorkingSpaceV3 = 'srgb' | 'display-p3' | 'rec2020';

export type ImageEditBitDepthV3 = 8 | 16 | 'float16' | 'float32';

export type ImageEditTransferFunctionV3 = 'srgb' | 'linear' | 'pq' | 'hlg';

export interface ImageEditCicpMetadataV3 {
  colorPrimaries: number;
  transferCharacteristics: number;
  matrixCoefficients: number;
  fullRange: boolean;
}

export interface ImageEditHdrMetadataV3 {
  standard: 'pq' | 'hlg';
  maxLuminanceNits?: number;
  minLuminanceNits?: number;
  maxContentLightLevelNits?: number;
  maxFrameAverageLightLevelNits?: number;
  cicp?: ImageEditCicpMetadataV3;
}

export interface ImageEditColorModeV3 {
  workingSpace: ImageEditWorkingSpaceV3;
  bitDepth: ImageEditBitDepthV3;
  transferFunction: ImageEditTransferFunctionV3;
  hdrMetadata: ImageEditHdrMetadataV3 | null;
  /** 内容寻址的 ICC profile；CICP 足够表达颜色时可以为空。 */
  iccProfileResourceId: string | null;
}

export function createDefaultImageEditColorModeV3(): ImageEditColorModeV3 {
  return {
    workingSpace: 'srgb',
    bitDepth: 8,
    transferFunction: 'srgb',
    hdrMetadata: null,
    iccProfileResourceId: null,
  };
}
