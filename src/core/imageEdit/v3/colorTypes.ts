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

export interface ImageEditHdrChromaticityV3 {
  x: number;
  y: number;
}

export interface ImageEditHdrContentLightV3 {
  maxContentLightLevelNits: number;
  maxFrameAverageLightLevelNits: number;
}

export interface ImageEditHdrMasteringDisplayV3 {
  red: ImageEditHdrChromaticityV3;
  green: ImageEditHdrChromaticityV3;
  blue: ImageEditHdrChromaticityV3;
  whitePoint: ImageEditHdrChromaticityV3;
  maxLuminanceNits: number;
  minLuminanceNits: number;
}

export interface ImageEditHdrMetadataV3 {
  standard: 'pq' | 'hlg';
  /** 线性工作空间中 1.0 对应的显示亮度。 */
  referenceWhiteNits: number;
  cicp: ImageEditCicpMetadataV3;
  contentLight?: ImageEditHdrContentLightV3;
  /** 只有完整色度坐标与亮度同时存在时才可写入 MDCV。 */
  masteringDisplay?: ImageEditHdrMasteringDisplayV3;
}

export const IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3 = 203;

export function createImageEditHdrMetadataV3(
  standard: ImageEditHdrMetadataV3['standard'],
  cicp?: ImageEditCicpMetadataV3,
): ImageEditHdrMetadataV3 {
  const transferCharacteristics = standard === 'pq' ? 16 : 18;
  return {
    standard,
    referenceWhiteNits: IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
    cicp: cicp
      ? { ...cicp }
      : {
        colorPrimaries: 9,
        transferCharacteristics,
        matrixCoefficients: 9,
        fullRange: false,
      },
  };
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
