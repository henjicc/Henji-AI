import { annotationContains, intentAnnotationSchema, transformAnnotationPoints, type IntentAnnotation } from '@/core/creativeIntent/annotationConstraints'
import { composeAffine, type Point } from '@/core/imaging/transforms'
import { flattenVectorPath } from '@/core/imaging/vectorContent'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ApplicationRef } from '@/core/application-control/identifiers'
import { findImageEditLayerLocationV3 } from '../editor/layerTreeV3'
import { resolveAnnotationOutputGeometryV3 } from '../editor/annotationGeometryV3'
import { imageEditV3LayerRef } from './imageEditDocumentRefs'

/** Role is supplied by a confirmed association. Layer names never classify decorative artwork. */
export function readImageIntentAnnotation(document: ImageEditDocumentV3, layerId: string, role: 'path' | 'target' | 'dwell' | 'text', targetRefs: ApplicationRef[] = []): IntentAnnotation {
  const location = findImageEditLayerLocationV3(document.layers, layerId)
  if (!location) throw new Error('标注图层已删除，请重新选择')
  const { layer, ancestors } = location
  if ([...ancestors, layer].some(l => !l.visible || l.deformation || l.mask && l.maskAttachment.enabled || l.clipping || l.filters.some(f => f.enabled))) throw new Error('标注含隐藏、变形或遮挡效果，请先确认可见几何')
  const output = resolveAnnotationOutputGeometryV3(document)
  let matrix = output.sourceToOutput
  for (const item of [...ancestors, layer]) matrix = composeAffine(matrix, item.transform)
  matrix = composeAffine([1 / output.width, 0, 0, 1 / output.height, 0, 0], matrix)
  let geometry: IntentAnnotation['geometry']; let text = ''
  if (layer.type === 'text' && role === 'text') {
    text = layer.content.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n')
    geometry = { kind: 'text', at: transformAnnotationPoints([[layer.content.box.x, layer.content.box.y]], matrix)[0] }
  } else if ((layer.type === 'path' || layer.type === 'shape') && role !== 'text') {
    if (layer.content.operands.length !== 1 || layer.content.operands[0].operation !== 'replace') throw new Error('请选单一箭头或圈；组合形状需先明确标注角色')
    const path = layer.content.operands[0].path
    const contour = flattenVectorPath(path, .01)[0]
    if (!contour) throw new Error('标注没有可读取的几何')
    const points = transformAnnotationPoints(contour.map(p => [p.x, p.y]), matrix)
    if (role === 'path') geometry = { kind: 'path', points }
    else {
      if (!path.commands.some(c => c.kind === 'close')) throw new Error('区域标注需要闭合的圈')
      geometry = { kind: 'region', role, outline: points }
    }
  } else throw new Error('所选图层不支持这个标注角色')
  return intentAnnotationSchema.parse({ sourceRef: imageEditV3LayerRef(document.id, layerId), sourceIdentity: JSON.stringify(layer), geometryIdentity: JSON.stringify([document.geometry, ancestors.map(a => [a.id, a.transform])]), targetRefs, span: null, text, geometry })
}

/** All matches remain explicit candidates for the host/deixis adapter to disambiguate. */
export function imageAnnotationTargets(annotation: IntentAnnotation, targets: readonly { ref: ApplicationRef; position: Point }[]): ApplicationRef[] {
  const geometry = annotation.geometry
  return geometry.kind === 'region' ? targets.filter(t => annotationContains(geometry.outline, t.position)).map(t => t.ref) : []
}
