import { describe, expect, it } from 'vitest'

import {
  createImageEditAnnotationLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { createImageEditorGpuBaselineFixturesV3 } from '../testing/imageEditorGpuBaselineV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'

function descriptors(resourceRefs: Iterable<string>) {
  return [...resourceRefs].map((resourceRef) => ({
    resourceRef: resourceRef as `sha256:${string}`,
    byteLength: 96 * 64 * 4,
    mediaType: 'image/png',
  }))
}

describe('compileImageEditorGpuRasterSceneV3', () => {
  it('保持根级普通栅格自下而上的顺序并去重资源键', () => {
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    const result = compileImageEditorGpuRasterSceneV3(
      fixture.document,
      descriptors(fixture.resourceSeeds.keys()),
    )
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.scene.layers.map((layer) => layer.layerId)).toEqual(
      fixture.document.layers.map((layer) => layer.id),
    )
    expect(result.scene.requiredResourceKeys).toHaveLength(5)
    expect(result.scene.layers[0]).toMatchObject({ visible: true, opacity: 1 })
  })

  it('组、蒙版、混合与HDR共同进入RenderGraph/颜色管线', () => {
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    const resources = descriptors(fixture.resourceSeeds.keys())
    const groupDocument = structuredClone(fixture.document)
    groupDocument.layers = [createImageEditGroupLayerV3('group', '组')]
    expect(compileImageEditorGpuRasterSceneV3(groupDocument, resources).supported).toBe(true)
    const blendDocument = structuredClone(fixture.document)
    blendDocument.layers[0].blendMode = 'screen'
    expect(compileImageEditorGpuRasterSceneV3(blendDocument, resources).supported).toBe(true)
    const complex = createImageEditorGpuBaselineFixturesV3().find((entry) => entry.id === 'complex-mask')!
    const complexResult = compileImageEditorGpuRasterSceneV3(
      complex.document,
      descriptors(complex.resourceSeeds.keys()),
    )
    expect(complexResult.supported).toBe(true)
    if (complexResult.supported) {
      expect(complexResult.scene.requiredResourceKeys.some((key) => key.format === 'r8unorm')).toBe(true)
      expect(complexResult.scene.graph.some((node) => node.kind === 'adjustment')).toBe(true)
    }
    const hdr = createImageEditorGpuBaselineFixturesV3().find((entry) => entry.id === 'hdr-rec2020')!
    expect(compileImageEditorGpuRasterSceneV3(
      hdr.document,
      descriptors(hdr.resourceSeeds.keys()),
    ).supported).toBe(true)
  })

  it('稀疏画笔和标注成为内容版本化GPU source，不再触发CPU回退', () => {
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    const document = structuredClone(fixture.document)
    const brushA = `sha256:${'1'.repeat(64)}` as const
    const brushB = `sha256:${'2'.repeat(64)}` as const
    const paint = createImageEditRasterLayerV3('paint', '画笔')
    paint.tiles = { '0/1/0': brushA, '0/2/1': brushB }
    const marks = createImageEditAnnotationLayerV3('marks', '标注')
    marks.annotations = [{
      id: 'mark-1', type: 'rect', x: 10, y: 20, width: 30, height: 40,
      stroke: WHITE_HEX, lineWidth: 2,
    }]
    document.layers = [paint, marks]
    const result = compileImageEditorGpuRasterSceneV3(document, descriptors([brushA, brushB]))
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.scene.layers.find((layer) => layer.layerId === 'paint')).toMatchObject({
      resourceRef: null, sourceKind: 'raster',
      sparseTiles: { '0/1/0': { resourceRef: brushA }, '0/2/1': { resourceRef: brushB } },
    })
    expect(result.scene.layers.find((layer) => layer.layerId === 'marks')).toMatchObject({
      sourceKind: 'annotation',
    })
    expect(result.scene.graph.filter((node) => node.kind === 'source')).toHaveLength(2)
  })

  it('标注内容指纹稳定命中纹理缓存，内容变化只失效标注source子图', () => {
    const base = `sha256:${'3'.repeat(64)}` as const
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    const document = structuredClone(fixture.document)
    const raster = createImageEditRasterLayerV3('base', '底图', base)
    const marks = createImageEditAnnotationLayerV3('marks', '标注')
    marks.annotations = [{ id: 'text-1', type: 'text', x: 12, y: 18, text: 'GPU',
      fontSize: 16, color: WHITE_HEX }]
    document.layers = [raster, marks]
    const first = compileImageEditorGpuRasterSceneV3(document, descriptors([base]))
    const repeated = compileImageEditorGpuRasterSceneV3(structuredClone(document), descriptors([base]))
    const changedDocument = structuredClone(document)
    const changedMarks = changedDocument.layers[1]
    if (changedMarks.type !== 'annotation') throw new Error('测试标注层类型异常')
    const changedText = changedMarks.annotations[0]
    if (changedText.type !== 'text') throw new Error('测试文字标注类型异常')
    changedText.text = 'GPU changed'
    const changed = compileImageEditorGpuRasterSceneV3(changedDocument, descriptors([base]))
    expect(first.supported && repeated.supported && changed.supported).toBe(true)
    if (!first.supported || !repeated.supported || !changed.supported) return
    const sourceFingerprints = (value: typeof first.scene) => new Map(value.graph
      .filter((node) => node.kind === 'source')
      .map((node) => [node.layerId, node.fingerprint]))
    expect(sourceFingerprints(repeated.scene)).toEqual(sourceFingerprints(first.scene))
    expect(sourceFingerprints(changed.scene).get('base')).toBe(sourceFingerprints(first.scene).get('base'))
    expect(sourceFingerprints(changed.scene).get('marks')).not.toBe(sourceFingerprints(first.scene).get('marks'))
    expect(changed.scene.layers.find((layer) => layer.layerId === 'marks')?.resourceRef)
      .not.toBe(first.scene.layers.find((layer) => layer.layerId === 'marks')?.resourceRef)
  })

  it('撤销重做恢复画笔tile内容身份且不会混用旧版本', () => {
    const beforeRef = `sha256:${'4'.repeat(64)}` as const
    const afterRef = `sha256:${'5'.repeat(64)}` as const
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    const before = structuredClone(fixture.document)
    const paint = createImageEditRasterLayerV3('paint-history', '画笔历史')
    paint.tiles = { '0/0/0': beforeRef }
    before.layers = [paint]
    const after = structuredClone(before)
    const afterPaint = after.layers[0]
    if (afterPaint.type !== 'raster') throw new Error('测试画笔层类型异常')
    afterPaint.tiles = { '0/0/0': afterRef }
    const resources = descriptors([beforeRef, afterRef])
    const compiledBefore = compileImageEditorGpuRasterSceneV3(before, resources)
    const compiledAfter = compileImageEditorGpuRasterSceneV3(after, resources)
    const compiledUndo = compileImageEditorGpuRasterSceneV3(structuredClone(before), resources)
    const compiledRedo = compileImageEditorGpuRasterSceneV3(structuredClone(after), resources)
    expect(compiledBefore.supported && compiledAfter.supported
      && compiledUndo.supported && compiledRedo.supported).toBe(true)
    if (!compiledBefore.supported || !compiledAfter.supported
      || !compiledUndo.supported || !compiledRedo.supported) return
    const version = (scene: typeof compiledBefore.scene) => scene.layers[0].sparseTiles['0/0/0']
    expect(version(compiledUndo.scene)).toEqual(version(compiledBefore.scene))
    expect(version(compiledRedo.scene)).toEqual(version(compiledAfter.scene))
    expect(version(compiledBefore.scene)).not.toEqual(version(compiledAfter.scene))
  })
})
