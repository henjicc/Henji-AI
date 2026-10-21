// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { observeImageEditColorV3, projectImageEditColorObservationDocumentV3 } from './imageEditColorObservationV3'

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
