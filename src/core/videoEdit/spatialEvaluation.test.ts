import { expect, it } from 'vitest'
import { createVideoEditSequence, videoEditComposition, createVideoEditDocument, splitVideoEditClip, type VideoEditClip } from './document'
import { evaluateSpatialFrame, evaluateSpatialCamera } from './spatialEvaluation'
import { videoEditClipToFrame, videoEditClipPictureSize } from './clipGeometry'
import { evaluateVideoEditClip } from './keyframes'

const output = { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 }
function fixture(change: Partial<VideoEditClip> = {}) {
  const document = createVideoEditDocument('空间'); const sequence = createVideoEditSequence()
  sequence.motionBlur = false
  sequence.clips = [{ id: 'subject', itemId: 'text', kind: 'text', name: '主体', track: 1, start: 0, duration: 100, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .1, y: -.1, scale: .4, rotation: 23, opacity: 1, volume: 0, text: '空间', spatial: { enabled: true }, ...change }]
  document.items = [{ id: 'text', kind: 'text', name: '文字' }]; document.sequences = [sequence]
  return videoEditComposition(document, sequence.id)
}
it('默认空间相机与原二维几何一致，非中心锚点仅改变轴心', () => {
  const composition = fixture({ anchorX: .2, anchorY: .8 })
  const frame = evaluateSpatialFrame(composition, 5, output, 'final')
  expect(frame.flatIdentity).toBe(true)
  const card = frame.cards[0]
  expect(card.centerWorld).not.toEqual(card.anchorWorld)
  for (const [index, uv] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
    const expected = videoEditClipToFrame(composition.clips[0], videoEditClipPictureSize(composition, composition.clips[0]), output, ...uv as [number, number])
    expect(card.screenPolygon[index][0]).toBeCloseTo(expected.x, 12)
    expect(card.screenPolygon[index][1]).toBeCloseTo(expected.y, 12)
  }
})
it('推拉变焦保持零深度取景，非零空间量不使用 epsilon 恒等旁路', () => {
  const composition = fixture({ rotation: 0 })
  const initial = evaluateSpatialFrame(composition, 5, output, 'final')
  composition.spatialCamera = { perspective: 2 }
  const zoom = evaluateSpatialFrame(composition, 5, output, 'final')
  zoom.cards[0].screenPolygon.forEach((point, i) => point.forEach((value, j) => expect(value).toBeCloseTo(initial.cards[0].screenPolygon[i][j], 12)))
  expect(zoom.flatIdentity).toBe(false)
  composition.spatialCamera = { rotationX: 1e-14 }
  expect(evaluateSpatialFrame(composition, 5, output, 'final').flatIdentity).toBe(false)
})
it('四个空间键沿通用切分保留多圈旋转和子帧轨迹，关闭空间仅停用贡献', () => {
  const composition = fixture({ depth: 2, curves: { rotationY: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 99, value: 1080, interpolation: 'linear' }] } })
  const split = splitVideoEditClip(composition, 'subject', 40)
  for (const time of [0, 38.75, 39, 40, 80.25, 99]) expect(evaluateVideoEditClip(split.clips[time < 40 ? 0 : 1], time).rotationY).toBeCloseTo(evaluateVideoEditClip(composition.clips[0], time).rotationY!, 10)
  composition.clips[0].spatial = { enabled: false }
  expect(evaluateSpatialFrame(composition, 50, output, 'final').flatIdentity).toBe(true)
  expect(composition.clips[0].curves!.rotationY![1].value).toBe(1080)
})
it('目标 hold 使用序列时钟；解除后休眠通道不制造绑定', () => {
  const camera = { aim: { kind: 'clip' as const, clipId: 'subject' }, bindings: { aim: [{ time: 12, value: null, interpolation: 'hold' as const }] } }
  expect(evaluateSpatialCamera(camera, 11.75).aim).toEqual(camera.aim)
  expect(evaluateSpatialCamera(camera, 12).aim).toBeUndefined()
  expect(() => evaluateSpatialFrame({ ...fixture(), spatialCamera: { aim: { kind: 'clip', clipId: 'missing' } } }, 2, output, 'final')).toThrow('不存在')
})
it('中心景深使用几何中心视深，对焦层零弥散，隐藏目标仍可求几何', () => {
  const composition = fixture({ rotation: 0, depth: 1, anchorX: .1, anchorDepth: .4 })
  composition.spatialCamera = { defocus: 1, focus: { kind: 'clip', clipId: 'subject' } }
  const frame = evaluateSpatialFrame(composition, 0, output, 'final')
  expect(frame.cards[0].cocRadiusPx).toBeCloseTo(0, 10)
  composition.clips[0].enabled = false
  const hidden = evaluateSpatialFrame(composition, 0, output, 'final')
  expect(hidden.camera.targetActive).toBe(false); expect(hidden.cards).toHaveLength(0)
})
it('角点贴合保留原透视四角，空间深度在参考平面之后应用', () => {
  const composition = fixture()
  const quad = [[.1, .15], [.85, .25], [.8, .85], [.3, .75]]
  Object.assign(composition.clips[0], { trackingQuad: quad })
  const frame = evaluateSpatialFrame(composition, 0, output, 'final')
  frame.cards[0].screenPolygon.forEach((point, index) => point.forEach((value, axis) => expect(value).toBeCloseTo(quad[index][axis], 12)))
  composition.clips[0].depth = .2
  const moved = evaluateSpatialFrame(composition, 0, output, 'final')
  expect(moved.cards[0].screenBounds.width).toBeGreaterThan(frame.cards[0].screenBounds.width)
})
