import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { imageColorGradeRuntimeParams } from '@/core/imaging/adjustments/schema'
import { ColorGradeExportRejection, type ColorGradeExportFormat, type ColorGradeLutSize } from '@/core/imaging/lut/colorGradeExport'
import type { CubeLut } from '@/core/imaging/lut/cube'
import { exportColorGradeFile, type ColorGradeExportFileResult } from '@/services/colorGradeExport'
import { loadImageColorLutV3 } from '../execution/imageColorLutV3'
import { findImageEditV3LiveLayer } from './imageEditDocumentRefs'

/** 全能调色调整层，或图层上 id 相同的全能调色调整滤镜（与颜色读数的寻址一致）。 */
export function findImageEditColorGradeV3(document: ImageEditDocumentV3, layerId: string): { params: unknown; name: string; opacity: number; blendMode: string; masked: boolean } {
  const location = findImageEditV3LiveLayer(document, layerId)
  if (location?.layer.type === 'adjustment' && location.layer.adjustmentId === 'color_grade') {
    const layer = location.layer
    return { params: layer.params, name: layer.name, opacity: layer.opacity, blendMode: layer.blendMode, masked: Boolean(layer.mask) }
  }
  const visit = (layers: readonly ImageEditLayerV3[]): ReturnType<typeof findImageEditColorGradeV3> | null => {
    for (const layer of layers) {
      const filter = layer.filters.find(value => value.id === layerId && value.operationType === 'adjustment' && value.effectId === 'color_grade')
      if (filter) return { params: filter.params, name: `${layer.name} 调色`, opacity: filter.opacity, blendMode: filter.blendMode, masked: Boolean(filter.mask) }
      const nested = layer.type === 'group' ? visit(layer.children) : null
      if (nested) return nested
    }
    return null
  }
  const found = visit(document.layers)
  if (!found) throw new ColorGradeExportRejection('请指定一个全能调色调整层。')
  return found
}

/** 导出图片调色层为 .cube / .cdl；不修改图片。图层不透明度、混合模式与蒙版属于合成，不进文件，如实列出。 */
export async function exportImageEditColorGradeV3(document: ImageEditDocumentV3, layerId: string, input: { format: ColorGradeExportFormat; lutSize?: ColorGradeLutSize; path: string; overwrite?: boolean; signal?: AbortSignal }): Promise<ColorGradeExportFileResult> {
  const grade = findImageEditColorGradeV3(document, layerId)
  let params: Record<string, unknown>
  try { params = imageColorGradeRuntimeParams(grade.params) } catch (error) { throw new ColorGradeExportRejection('调色参数无效，请先修正后再导出。', { cause: error }) }
  const luts = new Map<string, CubeLut>()
  for (const key of ['input_lut', 'look_lut']) {
    const ref = params[key]
    if (typeof ref !== 'string' || !ref || !Number(params[`${key}_strength`])) continue
    try { luts.set(ref, await loadImageColorLutV3(ref)) } catch (error) { throw new ColorGradeExportRejection(error instanceof Error ? error.message : String(error), { cause: error }) }
  }
  const omitted = [...grade.opacity < 1 ? [`不透明度 ${Math.round(grade.opacity * 100)}%（文件按 100% 写入）`] : [], ...grade.blendMode !== 'normal' ? ['混合模式'] : [], ...grade.masked ? ['蒙版'] : []]
  return exportColorGradeFile({ params, format: input.format, lutSize: input.lutSize, path: input.path, overwrite: input.overwrite, signal: input.signal, luts, omitted, title: grade.name })
}
