import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { planSpatialExposure } from './videoEditSpatialExposurePlan'
import { spatialMultiply, spatialTransform } from '@/core/videoEdit/spatialMatrices'
import type { SpatialFrameRequest } from './videoEditSpatialContracts'

function fixture(quality: SpatialFrameRequest['quality'] = 'final'): SpatialFrameRequest {
  const document = createVideoEditDocument('曝光'), sequence = createVideoEditSequence()
  sequence.motionBlur = true
  sequence.clips = ['card', 'scene'].map((id, index) => ({ id, itemId: 'text', kind: 'text', name: id, track: index, start: 0, duration: 50, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: .3, rotation: 0, opacity: .5, volume: 0, text: id, spatial: { enabled: true } }))
  sequence.spatialCamera = { defocus: 1, focus: { kind: 'distance', distance: 10 } }
  document.items = [{ id: 'text', kind: 'text', name: '文字' }]; document.sequences = [sequence]
  const composition = videoEditComposition(document, sequence.id)
  return { composition, sequenceFrame: 20, output: { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 }, quality, sessionKind: 'export', sources: [{ clipId: 'scene', kind: 'worldScene', spaceDependency: true }], requestId: 'exposure', signal: new AbortController().signal, assertCurrent() {} }
}
it('画幅外卡片仍准备可进入画面的景深扩边，相机背后不产生弥散贡献', () => {
  const request = fixture()
  request.sources = []
  const composition = request.composition as import('@/core/videoEdit/document').VideoEditComposition
  composition.clips = [{ ...composition.clips[0], x: .53, scale: .05 }]
  composition.spatialCamera = { defocus: 10, focus: { kind: 'distance', distance: 10 } }
  const plan = planSpatialExposure(request)
  expect(plan.centerFrame.cards[0].visiblePolygon).toHaveLength(0)
  expect(plan.centerFrame.cards[0].cocRadiusPx).toBeGreaterThan(40)
  expect(plan.materials[0].defocus.bypass).toBe(false)
  expect(plan.materials[0].logicalBounds.x).toBeLessThan(request.output.displayWidth)
  composition.clips[0].depth = 10
  expect(planSpatialExposure(request).centerFrame.cards[0].cocRadiusPx).toBe(0)
})
it('材料面景深换算抵消透视放大，降分辨率保持逻辑半径', () => {
  const request = fixture()
  request.sources = []
  request.composition = { ...request.composition, clips: [{ ...request.composition.clips[0], depth: 1 }] }
  const full = planSpatialExposure(request), half = planSpatialExposure({ ...request, output: { ...request.output, width: 960, height: 540 } })
  const a = full.materials[0], b = half.materials[0]
  const projectedScale = full.centerFrame.camera.position[2] / (full.centerFrame.camera.position[2] - 1)
  expect(a.defocus.materialRadiusPx[0] / a.rasterScale[0]).toBeCloseTo(a.defocus.centerCocRadiusPx / projectedScale, 10)
  expect(a.defocus.materialRadiusPx[1] / a.rasterScale[1]).toBeCloseTo(a.defocus.centerCocRadiusPx / projectedScale, 10)
  expect(b.defocus.materialRadiusPx[0] / b.rasterScale[0]).toBeCloseTo(a.defocus.materialRadiusPx[0] / a.rasterScale[0], 10)
  expect(b.defocus.centerCocRadiusPx).toBeCloseTo(a.defocus.centerCocRadiusPx / 2, 10)
  expect(a.logicalBounds.width).toBeGreaterThan(request.output.displayWidth * .3)
})
it('音频切点不截断画面曝光，运动禁用按中心相机冻结', () => {
  const request = fixture()
  request.composition = { ...request.composition, clips: [...request.composition.clips.map(clip => clip.id === 'card' ? { ...clip, motionBlur: false as const } : clip), { ...request.composition.clips[0], id: 'audio', kind: 'audio', start: 20 }], spatialCamera: { offsetX: .2, curves: { offsetX: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 40, value: 1, interpolation: 'linear' }] } } }
  const plan = planSpatialExposure(request)
  expect(plan.shotRange).toEqual([19.5, 20])
  for (const sample of plan.samples) expect(sample.frame.cards.find(card => card.clipId === 'card')!.clipFromUv).toEqual(plan.centerFrame.cards.find(card => card.clipId === 'card')!.clipFromUv)
})
it('亚像素深度交叉仍按完整快门采样整组遮挡', () => {
  const request = fixture()
  request.sources = []
  request.composition = { ...request.composition, clips: request.composition.clips.map((clip, index) => index ? clip : { ...clip,
    curves: { depth: [{ time: 18.75, value: -.0004, interpolation: 'linear' }, { time: 20.75, value: .0004, interpolation: 'linear' }] } }) }
  const plan = planSpatialExposure(request)
  expect(plan.samples).toHaveLength(16)
  expect(plan.groups[0].mode).toBe('group')
  expect(plan.groups[0].orderBySample[0]).toEqual([...plan.groups[0].orderBySample.at(-1)!].reverse())
})
it('准备后的真实世界范围扩展每个样本的裁剪面与两种投影', () => {
  const request = fixture(), initial = planSpatialExposure(request)
  expect(() => planSpatialExposure(request, [])).toThrow('真实包围框')
  const scenes = [{ index: -1 }, ...initial.samples].map(sample => ({ clipId: 'scene', sampleIndex: sample.index, sequenceFrame: request.sequenceFrame,
    worldBounds: { min: [-.1, -.1, -20] as const, max: [.1, .1, -19] as const } }))
  const plan = planSpatialExposure(request, scenes)
  for (const frame of [plan.centerFrame, ...plan.samples.map(sample => sample.frame)]) {
    const camera = frame.camera
    expect(camera.far).toBeGreaterThan(camera.position[2] + 20)
    const gpu = spatialTransform(spatialMultiply(camera.projectionWebGpu, camera.view), [0, 0, -20])
    const gl = spatialTransform(spatialMultiply(camera.projectionWebGl, camera.view), [0, 0, -20])
    expect(gpu[2]).toBeGreaterThan(0); expect(gpu[2]).toBeLessThan(1)
    expect(gl[2]).toBeGreaterThan(-1); expect(gl[2]).toBeLessThan(1)
    expect(frame.cards.find(card => card.clipId === 'scene')!.screenBounds.width).toBeGreaterThan(0)
  }
})
it('推近文字只按可见区域升档重栅格，视频不超过源像素密度，工作集保持在画面量级', () => {
  const request = fixture()
  request.sources = []
  const position = planSpatialExposure(request).centerFrame.camera.position[2]
  const pushed = (clip: import('@/core/videoEdit/document').VideoEditClip) => ({ ...clip, opacity: 1, depth: position * .75 })
  request.composition = { ...request.composition, spatialCamera: undefined, clips: [pushed(request.composition.clips[0])] }
  const text = planSpatialExposure(request).materials[0]
  expect(text.rasterScale[0]).toBeGreaterThanOrEqual(4)
  // 投影放大 4 倍时只栅格画幅内约四分之一的卡片，目标仍是输出量级而非整面乘倍率。
  expect(text.logicalBounds.width).toBeLessThanOrEqual(1920 * .3)
  expect(text.target.width).toBeLessThanOrEqual(1920 * 1.2)
  const composition = request.composition as import('@/core/videoEdit/document').VideoEditComposition
  composition.media = [{ id: 'low', name: '低清', path: '/fixture/low.mp4', kind: 'video', width: 640, height: 360, durationSeconds: 10, hasAudio: false }]
  composition.items = [...composition.items, { id: 'clip-video', name: '低清', kind: 'video', mediaId: 'low' }]
  composition.clips = [{ ...composition.clips[0], kind: 'video', itemId: 'clip-video' }]
  const video = planSpatialExposure(request).materials[0]
  expect(video.rasterScale[0]).toBeLessThan(1.1)
})
it('材料面纹素格对齐输出像素格，接近恒等时一倍栅格不产生亚像素缩放', () => {
  const request = fixture()
  request.sources = []
  request.composition = { ...request.composition, spatialCamera: undefined, clips: [{ ...request.composition.clips[0], y: -.17, depth: 1e-4 }] }
  for (const output of [request.output, { ...request.output, width: 960, height: 540 }]) {
    const material = planSpatialExposure({ ...request, output }).materials[0], scale = output.width / output.displayWidth
    expect(material.rasterScale).toEqual([scale, scale])
    expect(Number.isInteger(material.logicalBounds.x * scale) && Number.isInteger(material.logicalBounds.y * scale)).toBe(true)
  }
})
it('推近升档超出工作集预算时逐项降档并报告请求与实际档位', () => {
  const request = fixture()
  request.sources = []
  const position = planSpatialExposure(request).centerFrame.camera.position[2]
  const card = { ...request.composition.clips[0], opacity: 1, depth: position * .75 }
  request.composition = { ...request.composition, spatialCamera: undefined, clips: Array.from({ length: 110 }, (_, index) => ({ ...card, id: `card-${index}` })) }
  const plan = planSpatialExposure(request)
  expect(plan.workingSetBytes).toBeLessThanOrEqual(2 * 1024 ** 3)
  expect(plan.rasterLimits?.length).toBeGreaterThan(0)
  for (const limit of plan.rasterLimits!) expect(limit.tier).toBeLessThan(limit.wantedTier)
})
it('几何是平的但片段发光时渲染走三维，空间帧的几何恒等判据不受发光影响（压平、展开要用它）', async () => {
  const request = fixture()
  request.sources = []
  const composition = request.composition as import('@/core/videoEdit/document').VideoEditComposition
  composition.spatialCamera = undefined
  composition.clips = [{ ...composition.clips[0], depth: 0, rotationX: 0, rotationY: 0 }]
  const flat = planSpatialExposure(request)
  expect(flat.centerFrame.flatIdentity).toBe(true)
  composition.clips[0].spaceEmission = 1.5
  const glowing = planSpatialExposure(request)
  expect(glowing.centerFrame.flatIdentity).toBe(false)
  const { evaluateSpatialFrame } = await import('@/core/videoEdit/spatialEvaluation')
  expect(evaluateSpatialFrame(composition, request.sequenceFrame, request.output, request.quality).flatIdentity).toBe(true)
})
