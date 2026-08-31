import {
  convertFloat32TileColorDomainV3,
  convertFloat32TileWorkingSpaceV3,
  createFloat32PremultipliedRgbaTile,
  toneMapFloat32TileToSdrV3,
  type Float32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3'
import {
  IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  type ImageEditColorModeV3,
} from '@/core/imageEdit/v3/colorTypes'

/** FastProxy 的边界契约是 sRGB；进入效果图前显式转入文档工作原色与传递函数契约。 */
export function convertSrgbProxyToPreviewWorkingSpaceV3(
  tile: Float32PremultipliedRgbaTile,
  color: ImageEditColorModeV3,
): Float32PremultipliedRgbaTile {
  const converted = convertFloat32TileWorkingSpaceV3(tile, color.workingSpace)
  return createFloat32PremultipliedRgbaTile(
    converted.width,
    converted.height,
    converted.colorDomain,
    new Float32Array(converted.data),
    color.workingSpace,
    color.transferFunction,
    color.hdrMetadata?.referenceWhiteNits ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  )
}

/** 输出显式落到 sRGB；HDR tone-map 只作用于瞬态显示副本。 */
export function convertPreviewWorkingSpaceToSrgbDisplayV3(
  tile: Float32PremultipliedRgbaTile,
  color: ImageEditColorModeV3,
): Float32PremultipliedRgbaTile {
  const hdr = Boolean(color.hdrMetadata)
    || color.transferFunction === 'pq'
    || color.transferFunction === 'hlg'
  if (hdr) return toneMapFloat32TileToSdrV3(tile, 'srgb')
  const linear = convertFloat32TileColorDomainV3(tile, 'linear-light')
  const converted = convertFloat32TileWorkingSpaceV3(linear, 'srgb')
  return createFloat32PremultipliedRgbaTile(
    converted.width,
    converted.height,
    'linear-light',
    new Float32Array(converted.data),
    'srgb',
    'srgb',
    color.hdrMetadata?.referenceWhiteNits ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  )
}

export function describeImageEditorPreviewColorDiagnosticsV3(
  color: ImageEditColorModeV3,
): string[] {
  const diagnostics: string[] = []
  if (color.workingSpace === 'display-p3') {
    diagnostics.push('Display-P3 文档已显式转换为 sRGB 预览；权威颜色数据保持不变')
  } else if (color.workingSpace === 'rec2020') {
    diagnostics.push('Rec.2020 文档已显式转换为 sRGB 预览；权威颜色数据保持不变')
  }
  if (color.hdrMetadata || color.transferFunction === 'pq' || color.transferFunction === 'hlg') {
    diagnostics.push('HDR 文档当前显示为受控 SDR tone-map 代理；HDR 权威数据与元数据保持不变')
  }
  if (color.bitDepth !== 8) {
    diagnostics.push(`${String(color.bitDepth)} 位文档使用 8 位交互代理显示；最终高精度数据未降位`)
  }
  return diagnostics
}
