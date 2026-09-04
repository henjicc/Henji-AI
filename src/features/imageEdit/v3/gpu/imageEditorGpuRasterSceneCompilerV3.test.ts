import { describe, expect, it } from 'vitest'

import { createImageEditGroupLayerV3 } from '@/core/imageEdit/v3'
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

  it('复杂组、蒙版、混合和HDR不进入基础GPU语义', () => {
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    const resources = descriptors(fixture.resourceSeeds.keys())
    const groupDocument = structuredClone(fixture.document)
    groupDocument.layers = [createImageEditGroupLayerV3('group', '组')]
    expect(compileImageEditorGpuRasterSceneV3(groupDocument, resources).supported).toBe(false)
    const blendDocument = structuredClone(fixture.document)
    blendDocument.layers[0].blendMode = 'screen'
    expect(compileImageEditorGpuRasterSceneV3(blendDocument, resources).supported).toBe(false)
    const hdr = createImageEditorGpuBaselineFixturesV3().find((entry) => entry.id === 'hdr-rec2020')!
    expect(compileImageEditorGpuRasterSceneV3(
      hdr.document,
      descriptors(hdr.resourceSeeds.keys()),
    ).supported).toBe(false)
  })
})
