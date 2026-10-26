// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { parseImageColorGradeParams } from '@/core/imaging/adjustments/schema'
import { observeImageEditColorV3, projectImageEditColorObservationDocumentV3, suggestImageEditColorV3 } from './imageEditColorObservationV3'

const disposers: Array<() => void> = []
beforeEach(installHarnessNativeStorage)
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); uninstallHarnessNativeStorage() })

function setup() {
  const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'color-observation' })
  const group = createImageEditGroupLayerV3('group', '组')
  group.children = [createImageEditAdjustmentLayerV3('grade', '全能调整', 'color_grade', { exposure: .5 })]
  document.layers = [createImageEditRasterLayerV3('content', '内容'), group, createImageEditAdjustmentLayerV3('hsl', 'HSL', 'hsl', {})]
  const bus = new ImageEditCommandBusV3(document)
  disposers.push(registerPersistedImageEditTestSession('color-observation-session', bus))
  return { document, bus }
}

it('调色前读数只隐藏指定的全能调色层（含组内），其他层与原文档不变', () => {
  const { document } = setup()
  const before = projectImageEditColorObservationDocumentV3(document, 'grade', 'before_grade')
  const group = before.layers[1]
  expect(group.type === 'group' && group.children[0].visible).toBe(false)
  expect(before.layers[0]).toBe(document.layers[0]); expect(before.layers[2]).toBe(document.layers[2])
  expect(document.layers[1].type === 'group' && document.layers[1].children[0].visible).toBe(true)
  expect(projectImageEditColorObservationDocumentV3(document, undefined, 'document')).toBe(document)
  expect(() => projectImageEditColorObservationDocumentV3(document, 'hsl', 'before_grade')).toThrow('全能调色')
  expect(() => projectImageEditColorObservationDocumentV3(document, undefined, 'before_grade')).toThrow('指定')
})

it('读数来自正式像素读取并按当前修订号返回；读取中图片变化则拒绝旧读数', async () => {
  const { document, bus } = setup()
  const grey = Uint8ClampedArray.from(Array.from({ length: 64 }, () => [118, 118, 118, 255]).flat())
  const reader = vi.fn(async () => ({ pixels: grey, width: 8, height: 8 }))
  const result = await observeImageEditColorV3(document.id, { layerId: 'grade', stage: 'before_grade', scopes: true, reader })
  expect(result.revision).toBe(document.revision); expect(result.stage).toBe('before_grade')
  expect(result.statistics.readout.exposure.middleGrayOffsetEv).toBeCloseTo(0, 0)
  expect(result.statistics.scopes?.histogram.luma).toHaveLength(64)
  const rendered = (reader.mock.calls[0] as unknown[])[0] as typeof document
  expect(rendered.layers[1].type === 'group' && rendered.layers[1].children[0].visible).toBe(false)
  const changing = vi.fn(async () => { bus.dispatch({ type: 'layer.update-common', commandId: 'rename', expectedRevision: bus.getSnapshot().document.revision, layerId: 'content', patch: { opacity: .5 } }); return { pixels: grey, width: 8, height: 8 } })
  await expect(observeImageEditColorV3(document.id, { reader: changing })).rejects.toThrow('已变化')
})

it('自动校色只分析隐藏该调整层后的画面，返回白平衡与曝光的绝对建议', async () => {
  const { document } = setup()
  // A warm, dark grey card: the suggestion must cool it down (kelvin below 6500) and brighten it.
  const warm = Uint8ClampedArray.from(Array.from({ length: 256 }, (_, i) => { const v = 40 + (i % 16) * 3; return [Math.min(255, v * 1.25), v, Math.round(v * .7), 255] }).flat())
  const reader = vi.fn(async () => ({ pixels: warm, width: 16, height: 16 }))
  const { parameters: suggestion, apply } = await suggestImageEditColorV3(document, 'grade', [], new AbortController().signal, reader)
  expect(apply).toBe('merge')
  expect(Object.keys(suggestion).sort()).toEqual(['exposure', 'temperature_kelvin', 'tint'])
  expect(suggestion.temperature_kelvin).toBeLessThan(5000); expect(suggestion.exposure).toBeGreaterThan(0)
  const rendered = (reader.mock.calls[0] as unknown[])[0] as typeof document
  expect(rendered.layers[1].type === 'group' && rendered.layers[1].children[0].visible).toBe(false)
})

it('拿另一张图做参考：与剪辑镜头匹配同一套 MKL 反拟合，返回整体替换的滑块值，可直接写成合法调整层参数', async () => {
  const { document } = setup()
  const card = (gain: readonly number[]) => Uint8ClampedArray.from(Array.from({ length: 256 }, (_, i) => { const v = 30 + (i % 16) * 12; const hue = Math.floor(i / 16); return [v * gain[0] * (1 + .03 * (hue % 3)), v * gain[1] * (1 + .03 * (hue % 5) / 2), v * gain[2], 255].map(x => Math.min(255, Math.round(x))) }).flat())
  const warm = card([1.15, 1, .75]); const neutral = card([1, 1, 1])
  const reader = vi.fn(async () => ({ pixels: warm, width: 16, height: 16 }))
  const { parameters, apply } = await suggestImageEditColorV3(document, 'grade', [], new AbortController().signal, reader, neutral)
  expect(apply).toBe('replace')
  expect(Object.keys(parameters).sort()).toEqual(['contrast', 'exposure', 'highlights', 'saturation', 'shadows', 'temperature_kelvin', 'tint'])
  expect(parameters.temperature_kelvin).toBeLessThan(6000) // 偏暖的画面向中性参考匹配 → 写低于 6500 的光源值
  expect(() => parseImageColorGradeParams(parameters)).not.toThrow()
  const rendered = (reader.mock.calls[0] as unknown[])[0] as typeof document
  expect(rendered.layers[1].type === 'group' && rendered.layers[1].children[0].visible).toBe(false)
})

it('图层上的全能调色滤镜按滤镜标识关闭，图层本身仍可见', () => {
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'filter-grade' })
  const content = createImageEditRasterLayerV3('content', '内容')
  content.filters = [{ id: 'grade-filter', operationType: 'adjustment', effectId: 'color_grade', params: { exposure: 1 }, enabled: true, opacity: 1, blendMode: 'normal', mask: null }]
  document.layers = [content]
  const before = projectImageEditColorObservationDocumentV3(document, 'grade-filter', 'before_grade')
  expect(before.layers[0].visible).toBe(true); expect(before.layers[0].filters[0].enabled).toBe(false)
  expect(document.layers[0].filters[0].enabled).toBe(true)
})
