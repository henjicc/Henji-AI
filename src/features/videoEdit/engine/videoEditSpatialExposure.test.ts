import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { planSpatialExposure, renderSpatialExposure } from './videoEditSpatialExposure'
import { spatialMultiply, spatialTransform } from '@/core/videoEdit/spatialMatrices'
import { preparedSpatialBrand, spatialAccumulatorBrand, type SpatialCodeSources, type SpatialCompositeHost, type SpatialFrameRequest, type SpatialPictureLease, type SpatialSceneSample } from './videoEditSpatialContracts'

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
function harness(request: SpatialFrameRequest, crossing: boolean, failAfter = Infinity) {
  const calls: string[] = [], live = new Set<SpatialPictureLease>()
  const groups: Array<{ frame: number; items: Array<{ id: string; kind: string; opacity: number }> }> = []
  let observations: SpatialSceneSample[] = [], additions = 0, currentId = 0
  const picture = (owner: SpatialPictureLease['owner'] = 'composite-host'): SpatialPictureLease => {
    const id = currentId++
    const result: SpatialPictureLease = { owner, texture: { createView: () => ({}), destroy() {} }, width: 1920, height: 1080, format: 'rgba16float', highPrecision: true, carriesLight: true, completion: Promise.resolve(),
      async release(afterUse) { expect(live.has(result)).toBe(true); await afterUse; live.delete(result); calls.push(`release:${id}`) } }
    live.add(result); return result
  }
  const sources: SpatialCodeSources = {
    async describeSpatialSources() { return request.sources },
    async prepareSpatialFrame({ plan }) {
      calls.push('prepare')
      observations = [{ index: -1, sequenceFrame: request.sequenceFrame }, ...plan.samples].map(sample => {
        const z = crossing ? (sample.sequenceFrame - request.sequenceFrame) * 2 : -.4
        return { clipId: 'scene', sampleIndex: sample.index, sequenceFrame: sample.sequenceFrame, worldBounds: { min: [-.1, -.1, z], max: [.1, .1, z] } }
      })
      return { [preparedSpatialBrand]: true }
    },
    async inspectSpatialSceneSamples() { calls.push('inspect'); return observations },
    async renderSpatialSample(sample) { calls.push(`scene:${sample.sampleIndex}`); return picture('code-sources') },
    generatorTargetCapacity: () => 20,
    async releaseSpatialFrame() { calls.push('release-prepared') },
  }
  const host: SpatialCompositeHost = {
    generatorTargetCapacity: () => 20, async reserveWorkingSet() { calls.push('reserve') },
    async prepareCardMaterial(_request, material) { calls.push(`card:${material.clipId}`); return picture() },
    async consumePicture() { calls.push('consume'); return picture() },
    async applyCenterDefocus(_picture, material) { calls.push(`defocus:${material.clipId}`); return picture() },
    async beginAccumulation() { calls.push('begin'); return { [spatialAccumulatorBrand]: true } },
    async accumulateLayerSample(_accumulator, item) { calls.push(`layer:${item.clipId}`); return { completion: Promise.resolve() } },
    async finishLayer() { calls.push('finish-layer'); return picture() },
    async compositeGroup(_group, sample, items) { groups.push({ frame: sample.sequenceFrame, items: items.map(item => ({ id: item.clipId, kind: item.kind, opacity: item.opacity })) }); calls.push(`group:${items.map(item => item.clipId).join(',')}`); return picture() },
    async accumulate() { if (++additions >= failAfter) throw new Error('cancelled-submit'); calls.push('accumulate'); return { completion: Promise.resolve() } },
    async finish() { calls.push('finish'); return picture() },
    async compositeFrame() { calls.push('frame'); return picture() },
    async releaseAccumulation() { calls.push('release-accumulator') },
    async releaseWorkingSet() { calls.push('release-working-set') },
  }
  return { calls, live, groups, sources, host }
}
it.each(['interactive', 'final'] as const)('换序场景 %s 按同一样本姿态景深后整组合成，普通卡片只准备一次', async quality => {
  const request = fixture(quality), context = harness(request, true)
  const result = await renderSpatialExposure(request, planSpatialExposure(request), context.sources, context.host)
  const count = quality === 'interactive' ? 8 : 16
  expect(context.calls.filter(call => call.startsWith('scene:'))).toHaveLength(count)
  expect(context.calls.filter(call => call === 'defocus:scene')).toHaveLength(count)
  expect(context.calls.filter(call => call === 'card:card')).toHaveLength(1)
  expect(context.calls.filter(call => call === 'defocus:card')).toHaveLength(1)
  expect(context.calls.filter(call => call === 'accumulate')).toHaveLength(count)
  expect(new Set(context.calls.filter(call => call.startsWith('group:'))).size).toBe(2)
  expect(context.live.size).toBe(1)
  await result.release(Promise.resolve()); expect(context.live.size).toBe(0)
})
it('稳定层序场景逐样本累积后只做一次中心景深', async () => {
  const request = fixture(), context = harness(request, false)
  const result = await renderSpatialExposure(request, planSpatialExposure(request), context.sources, context.host)
  expect(context.calls.filter(call => call.startsWith('scene:'))).toHaveLength(16)
  expect(context.calls.filter(call => call === 'defocus:scene')).toHaveLength(1)
  const focus = context.calls.indexOf('defocus:scene')
  expect(context.calls.lastIndexOf('layer:scene')).toBeLessThan(focus)
  expect(context.calls.indexOf('frame')).toBeGreaterThan(focus)
  await result.release(Promise.resolve()); expect(context.live.size).toBe(0)
})
it('中途提交失败释放全部借用与准备对象，不发布部分曝光', async () => {
  const request = fixture(), context = harness(request, true, 2)
  await expect(renderSpatialExposure(request, planSpatialExposure(request), context.sources, context.host)).rejects.toThrow('cancelled-submit')
  expect(context.calls).not.toContain('frame')
  expect(context.live.size).toBe(0)
  expect(context.calls).toContain('release-prepared')
  expect(context.calls).toContain('release-working-set')
})

it('清理失败时释放尚未交付的最终纹理', async () => {
  const request = fixture(), context = harness(request, false)
  context.host.releaseWorkingSet = async () => { throw new Error('cleanup-failed') }
  await expect(renderSpatialExposure(request, planSpatialExposure(request), context.sources, context.host)).rejects.toThrow('资源释放失败')
  expect(context.live.size).toBe(0)
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
  expect(plan.shotRange).toEqual([19.75, 20.25])
  for (const sample of plan.samples) expect(sample.frame.cards.find(card => card.clipId === 'card')!.clipFromUv).toEqual(plan.centerFrame.cards.find(card => card.clipId === 'card')!.clipFromUv)
})
it('亚像素深度交叉仍按完整快门采样整组遮挡', () => {
  const request = fixture()
  request.sources = []
  request.composition = { ...request.composition, clips: request.composition.clips.map((clip, index) => index ? clip : { ...clip,
    curves: { depth: [{ time: 19, value: -.0004, interpolation: 'linear' }, { time: 21, value: .0004, interpolation: 'linear' }] } }) }
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
it('稳定层序的转场在每个子时刻合成两端及淡化后累积，不重复混合终图', async () => {
  const request = fixture()
  request.sources = []
  request.composition = { ...request.composition, clips: request.composition.clips.map((clip, index) => ({ ...clip, track: 1, start: index ? 20 : 0, duration: index ? 30 : 20, ...(index ? { fadeInFrames: 10 } : {}) })),
    transitions: [{ id: 'crossing', kind: 'cross_dissolve', leftClipId: 'card', rightClipId: 'scene', durationFrames: 10 }] }
  const plan = planSpatialExposure(request), context = harness(request, false)
  expect(plan.groups[0].mode).toBe('transform')
  const result = await renderSpatialExposure(request, plan, context.sources, context.host)
  expect(context.groups.slice(0, -1)).toHaveLength(16)
  expect(context.groups.slice(0, -1).every(group => group.items.length === 2 && group.items.every(item => item.kind === 'transition'))).toBe(true)
  expect(context.groups[15].items.find(item => item.id === 'scene')!.opacity).toBeGreaterThan(0)
  expect(context.groups.at(-1)!.items).toEqual([{ id: 'card', kind: 'card', opacity: 1 }])
  await result.release(Promise.resolve()); expect(context.live.size).toBe(0)
})

it('世界场景与二维卡片的转场先单独曝光空间侧，保留原转场混合', async () => {
  const request = fixture()
  request.composition = { ...request.composition, clips: request.composition.clips.map((clip, index) => ({ ...clip, track: 1,
    start: index ? 20 : 0, duration: index ? 30 : 20, spatial: { enabled: false } })),
    transitions: [{ id: 'mixed', kind: 'cross_dissolve', leftClipId: 'card', rightClipId: 'scene', durationFrames: 10 }] }
  const plan = planSpatialExposure(request), context = harness(request, false)
  expect(plan.groups.map(group => group.itemIds)).toEqual([['scene']])
  expect(plan.materials.map(material => material.clipId)).toEqual(['scene'])
  const result = await renderSpatialExposure(request, plan, context.sources, context.host)
  expect(context.groups.at(-1)!.items.map(item => item.id)).toEqual(['scene'])
  await result.release(Promise.resolve()); expect(context.live.size).toBe(0)
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
