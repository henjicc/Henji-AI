import { expect, it } from 'vitest'
import { createImageEditDocumentV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { imageEditLayersFromMarkDraftV3 } from '@/core/imageEdit/v3/layerEntries/vectorDraft'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import { imageAnnotationTargets, readImageIntentAnnotation } from './imageEditIntentAnnotationAdapter'

it('正式弯箭头读取尾尖而非箭头翼，裁剪旋转和祖先变换只应用一次，不复制作品状态', () => {
  const document = createImageEditDocumentV3({ documentId: 'p', width: 1000, height: 600 })
  const arrow = imageEditLayersFromMarkDraftV3({ id: 'arrow', type: 'arrow', points: [100, 100, 400, 200], curveControl: [200, 50], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 3 })[0]
  const group = createImageEditGroupLayerV3('group', 'group'); group.transform = [1, 0, 0, 1, 20, 30]; group.children = [arrow]
  document.layers = [group]; document.geometry.orientation = { rotate: 90, mirrored: false }; document.geometry.crop = { x: 10, y: 20, width: 400, height: 700 }
  const before = JSON.stringify(document); const annotation = readImageIntentAnnotation(document, 'arrow', 'path')
  expect(annotation.span).toBeNull(); expect(annotation.geometry.kind).toBe('path')
  if (annotation.geometry.kind === 'path') {
    expect(annotation.geometry.points[0][0]).toBeCloseTo(1.15)
    expect(annotation.geometry.points[0][1]).toBeCloseTo(1 / 7)
    expect(annotation.geometry.points.at(-1)![0]).toBeCloseTo(.9)
    expect(annotation.geometry.points.at(-1)![1]).toBeCloseTo(4 / 7)
    expect(annotation.geometry.points.length).toBeGreaterThan(2)
  }
  expect(JSON.stringify(document)).toBe(before)
})
it('圈内多目标不猜唯一目标，文本只做意图提示，删除或奇异矩阵拒绝', () => {
  const document = createImageEditDocumentV3({ documentId: 'p', width: 1000, height: 600 })
  document.layers = imageEditLayersFromMarkDraftV3({ id: 'circle', type: 'ellipse', x: 100, y: 100, width: 300, height: 300, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 3 })
  const annotation = readImageIntentAnnotation(document, 'circle', 'target')
  const targets = [[.2, .4], [.3, .4], [.8, .4]].map((position, i) => ({ ref: { kind: 'image_edit.layer', id: `p:${i}` }, position: [position[0], position[1]] as [number, number] }))
  expect(imageAnnotationTargets(annotation, targets)).toEqual(targets.slice(0, 2).map(t => t.ref))
  expect(() => readImageIntentAnnotation(document, 'deleted', 'target')).toThrow('已删除')
  document.layers[0].transform = [0, 0, 0, 0, 0, 0]
  expect(() => readImageIntentAnnotation(document, 'circle', 'target')).toThrow('可逆')
})
