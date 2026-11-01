import { expect, it } from 'vitest'
import { changeVideoEditSequenceSettings, createVideoEditDocument, createVideoEditSequence, videoEditComposition, splitVideoEditClip } from './document'
import { applySpatialPatch, planSpatialPropagation, remapSpatialCameraReferences, retimeSpatialCamera, splitSpatialCameraTarget } from './spatialPropagation'
import { evaluateSpatialCamera, evaluateSpatialFrame } from './spatialEvaluation'
import type { SpatialCamera } from './spatialTypes'

const output = { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 }
function fixture() {
  const document = createVideoEditDocument('引用传播'), sequence = createVideoEditSequence()
  sequence.clips = [{ id: 'subject', itemId: 'text', kind: 'text', name: '目标', track: 1, start: 0, duration: 12, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: .3, rotation: 0, opacity: 1, volume: 0, text: '目标', spatial: { enabled: true }, curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 11, value: .2, interpolation: 'linear' }] } }]
  sequence.spatialCamera = { aim: { kind: 'clip', clipId: 'subject' } }
  document.items = [{ id: 'text', kind: 'text', name: '目标' }]; document.sequences = [sequence]
  return videoEditComposition(document, sequence.id)
}
it('分割按序列切点切换目标，明确解除绑定不会复活静态目标', () => {
  const composition = fixture(), split = splitVideoEditClip(composition, 'subject', 5)
  expect(evaluateSpatialCamera(split.spatialCamera, 4.75).aim).toEqual({ kind: 'clip', clipId: 'subject' })
  expect(evaluateSpatialCamera(split.spatialCamera, 5).aim).toEqual({ kind: 'clip', clipId: split.clips[1].id })
  const camera: SpatialCamera = { ...composition.spatialCamera, bindings: { aim: [{ time: 3, value: null, interpolation: 'hold' }] } }
  expect(evaluateSpatialCamera(splitSpatialCameraTarget(camera, 'subject', 'right', 5), 6).aim).toBeUndefined()
})
it('整序列复制重映射全部引用，帧率变换保留解除事件与曲线来源', () => {
  const camera: SpatialCamera = { aim: { kind: 'clip', clipId: 'a' }, bindings: { focus: [{ time: 4, value: { kind: 'clip', clipId: 'b' }, interpolation: 'hold' }, { time: 8, value: null, interpolation: 'hold' }] }, curves: { offsetX: [{ time: 0, value: 0, interpolation: 'bezier', bezier: [.2, .1, .8, .9] }, { time: 10, value: 1, interpolation: 'linear' }] } }
  const mapped = remapSpatialCameraReferences(camera, new Map([['a', 'copy-a'], ['b', 'copy-b']]))
  const retimed = retimeSpatialCamera(mapped, time => time * 2)
  expect(retimed.aim).toEqual({ kind: 'clip', clipId: 'copy-a' })
  expect(evaluateSpatialCamera(retimed, 8).focus).toEqual({ kind: 'clip', clipId: 'copy-b' })
  expect(evaluateSpatialCamera(retimed, 16).focus).toBeUndefined()
  expect(evaluateSpatialCamera(retimed, 7.5).offsetX).toBeCloseTo(evaluateSpatialCamera(camera, 3.75).offsetX!, 12)
})
it('删除运动目标前烘焙世界轨迹，保持绑定解除与其他种类的数值通道', async () => {
  const before = fixture()
  before.spatialCamera = { ...before.spatialCamera, curves: { aimX: [{ time: 0, value: -.1, interpolation: 'linear' }, { time: 11, value: .1, interpolation: 'linear' }] }, bindings: { aim: [{ time: 4, value: null, interpolation: 'hold' }, { time: 6, value: { kind: 'point', point: [0, .1, 0] }, interpolation: 'hold' }] } }
  const result = await planSpatialPropagation({ before: { composition: before, sequenceId: before.id, revision: before.revision }, proposed: { ...before, clips: [] }, operation: 'delete', clipMap: [{ fromSequenceId: before.id, fromClipId: 'subject', sourceRange: [0, 12], toSequenceId: before.id, toClipId: null }], sequenceTimeMap: [], output, quality: 'final', signal: new AbortController().signal })
  for (const time of [0, 2.25, 4, 5.5, 6, 8.75, 11]) {
    const original = evaluateSpatialFrame(before, time, output, 'final')
    const baked = evaluateSpatialFrame(result.composition, time, output, 'final')
    baked.camera.view.forEach((value, i) => expect(value).toBeCloseTo(original.camera.view[i], 8))
  }
  expect(before.spatialCamera.aim).toEqual({ kind: 'clip', clipId: 'subject' })
})
it('纯 patch 拒绝过期结果，取消传播不会修改输入', async () => {
  const before = fixture(), snapshot = { composition: before, sequenceId: before.id, revision: before.revision }
  expect(() => applySpatialPatch(snapshot, { sequenceId: before.id, expectedRevision: before.revision + 1, clips: [], achievedParallaxRatio: 1, maxProjectionErrorPx: 0, facts: [] })).toThrow('已变化')
  const controller = new AbortController(); controller.abort()
  await expect(planSpatialPropagation({ before: snapshot, proposed: before, operation: 'fields', clipMap: [], sequenceTimeMap: [], output, quality: 'final', signal: controller.signal })).rejects.toThrow()
  expect(before.clips).toHaveLength(1)
})
it('空序列改画幅和帧率保留完整相机时间域', () => {
  const sequence = createVideoEditSequence('镜头')
  sequence.frameRate = { numerator: 30, denominator: 1 }
  sequence.spatialCamera = { curves: { offsetX: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 100, value: 1, interpolation: 'linear' }] },
    bindings: { aim: [{ time: 80, value: { kind: 'point', point: [1, 0, 0] }, interpolation: 'hold' }, { time: 120, value: null, interpolation: 'hold' }] } }
  expect(changeVideoEditSequenceSettings(sequence, { width: 1000 }).spatialCamera).toEqual(sequence.spatialCamera)
  const changed = changeVideoEditSequenceSettings(sequence, { frameRate: { numerator: 60, denominator: 1 } })
  expect(changed.spatialCamera?.curves?.offsetX?.map(point => point.time)).toEqual([0, 200])
  expect(changed.spatialCamera?.bindings?.aim?.map(point => point.time)).toEqual([160, 240])
})
