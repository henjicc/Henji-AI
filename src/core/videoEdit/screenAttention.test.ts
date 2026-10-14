import { expect, it } from 'vitest'
import { captureEventSchema, type CapturePayload, type CaptureEvent } from '../captureLog/events'
import { sampleScreenAttention, screenAttentionSettingsSchema } from './screenAttention'
import { generateVideoEditReframeKeyframes, smoothVideoEditAttention } from './reframe'
import { evaluateVideoEditKeyframes, isVideoEditMotionKeyframe, writeVideoEditClipKeyframes, sliceVideoEditClipKeyframes, rescaleVideoEditClipKeyframes } from './keyframes'
import { videoEditFrameToClip } from './clipGeometry'
import type { VideoEditClip } from './document'

const picture = { width: 1920, height: 1080 }
const settings = screenAttentionSettingsSchema.parse({})
const event = (time: number, payload: CapturePayload): CaptureEvent => captureEventSchema.parse({ ...payload, eventId: String(time), seq: time, monoUs: time, recordingUs: time, clockSegmentRef: 'clock', timeline: null, unavailableReason: 'static' })
const click = (time: number, x = 1400) => event(time, { kind: 'click', phase: 'down', button: 'left', point: [x, 500] })
const clip: VideoEditClip = { id: 'clip', itemId: 'item', name: '录屏', kind: 'video', track: 1, start: 120, duration: 600, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
function draft(events: CaptureEvent[], target = picture) {
  const samples = sampleScreenAttention(events, Array.from({ length: clip.duration }, (_, i) => i / 60 * 1e6), picture, target, settings)
  return generateVideoEditReframeKeyframes(clip, samples.map(value => value.box), picture, target, 60, { attention: 'auto', motion: 'default' }, [], { source: 'screen_attention', zoom: samples.map(value => value.zoom), transitionSeconds: settings.transitionSeconds })
}
it('点击生成关注框，松开不重触发；没有信号、无位置/越界信号回全景', () => {
  const samples = sampleScreenAttention([click(1e6), event(1.1e6, { kind: 'click', phase: 'up', button: 'left', point: [1400, 500] }), click(4e6, -1)], [0, 1e6, 3.05e6, 5e6], picture, picture, settings)
  expect(samples[0]).toEqual({ box: null, zoom: 1 })
  expect(samples[1].box!.x + samples[1].box!.width / 2).toBeCloseTo(1400 / 1920)
  expect(samples[1].zoom).toBe(1.8)
  expect(samples[2].box).toBeNull(); expect(samples[3].box).toBeNull()
})
it('持续光标停留才推近；缺采样、隐藏和移动重置停留；单次按键不冒充输入区', () => {
  const cursors = Array.from({ length: 181 }, (_, i) => event(i * 10000, { kind: 'cursor', point: [900, 400], shape: 'text' }))
  const samples = sampleScreenAttention(cursors, [0, 1e6, 1.3e6], picture, picture, settings)
  expect(samples[1].box).toBeNull(); expect(samples[2].box).not.toBeNull()
  expect(sampleScreenAttention([cursors[0], cursors[180]], [1.8e6], picture, picture, settings)[0].box).toBeNull()
  const typing = [...cursors.slice(0, 10), event(100000, { kind: 'key', category: 'typing' }), event(200000, { kind: 'key', category: 'typing' })]
  const result = sampleScreenAttention(typing, [100000, 200000], picture, picture, settings)
  expect(result[0].box).toBeNull(); expect(result[1].box!.width).toBeCloseTo(0.4)
  expect(sampleScreenAttention([event(0, { kind: 'key', category: 'typing' }), event(100000, { kind: 'key', category: 'typing' })], [100000], picture, picture, settings)[0].box).toBeNull()
})
it('能力捕获框优先于点击、窗口和打字；窗口像素框裁到捕获画面，暂停清空陈旧关注', () => {
  const call = event(1e6, { kind: 'capability', callId: 'call', capability: 'sample_operation', targets: [{ kind: 'canvas.node', id: 'target' }], phase: 'started' })
  const events = [event(0, { kind: 'window', windowId: 'window', available: true, bounds: { x: -50, y: 0, width: 1100, height: 600 } }), click(500000), call, event(1.5e6, { kind: 'control', action: 'pause' })]
  const box = { x: .1, y: .2, width: .15, height: .1 }
  const result = sampleScreenAttention(events, [0, 1e6, 1.5e6], picture, picture, settings, [{ eventId: call.eventId, box }])
  expect(result[0].box!.x).toBe(0); expect(result[1].box).toEqual(box); expect(result[2].box).toBeNull()
})
it('最短停留抑制连续远处点击；高优先级信号可打断，source 倒序请求结果一致', () => {
  const events = [click(0, 200), click(100000, 1600)]
  const times = [0, 100000, 1.3e6]
  const result = sampleScreenAttention(events, times, picture, picture, settings)
  expect(result[1].box).toEqual(result[0].box); expect(result[2].box).not.toEqual(result[0].box)
  expect(sampleScreenAttention(events, [...times].reverse(), picture, picture, settings)).toEqual([...result].reverse())
})
it('推近、停留、退回全景共用 reframe 平滑；缩减误差受控且全程没有自动黑边', () => {
  const events = [click(1e6, 1800)]
  const result = draft(events)
  expect(evaluateVideoEditKeyframes(result.curves?.scale, 120, 1)).toBeGreaterThan(1.65)
  expect(evaluateVideoEditKeyframes(result.curves?.scale, 599, 1)).toBeCloseTo(1, 4)
  expect(evaluateVideoEditKeyframes(result.curves?.x, 599, 0)).toBeCloseTo(0, 4)
  expect(result.curves!.scale!.every(point => isVideoEditMotionKeyframe(point, 'screen_attention'))).toBe(true)
  const samples = sampleScreenAttention(events, Array.from({ length: 600 }, (_, i) => i / 60 * 1e6), picture, picture, settings)
  const full = smoothVideoEditAttention(samples.map(value => value.box), picture, picture, 60, 'default', [], { source: 'screen_attention', zoom: samples.map(value => value.zoom), transitionSeconds: settings.transitionSeconds })
  for (let time = 0; time < 600; time++) {
    const placement = { ...result, x: evaluateVideoEditKeyframes(result.curves!.x, time, 0), y: evaluateVideoEditKeyframes(result.curves!.y, time, 0), scale: evaluateVideoEditKeyframes(result.curves!.scale, time, 1) }
    expect(Math.abs(placement.scale - full[time].scale)).toBeLessThanOrEqual(.000501)
    for (const [x, y] of [[0, 0], [1, 1]]) {
      const point = videoEditFrameToClip(placement, picture, picture, x, y)
      expect(point.u).toBeGreaterThanOrEqual(-1e-8); expect(point.u).toBeLessThanOrEqual(1 + 1e-8)
      expect(point.v).toBeGreaterThanOrEqual(-1e-8); expect(point.v).toBeLessThanOrEqual(1 + 1e-8)
    }
  }
})
it('重算保留手改、其他来源及锚点；剪切与变速重映射来源基线后仍可重算', () => {
  const generated = draft([click(1e6)])
  const point = generated.curves!.scale![2]
  const changed = writeVideoEditClipKeyframes(generated, 'scale', generated.curves!.scale!.map(value => value === point ? { ...value, value: 1.7 } : value))
  expect(changed.curves!.scale!.find(value => value.time === point.time)?.source).toBeUndefined()
  const events = [click(2e6)]
  const samples = sampleScreenAttention(events, Array.from({ length: 600 }, (_, i) => i / 60 * 1e6), picture, picture, settings)
  const again = generateVideoEditReframeKeyframes(changed, samples.map(v => v.box), picture, picture, 60, { attention: 'auto', motion: 'default' }, [], { source: 'screen_attention', zoom: samples.map(v => v.zoom), transitionSeconds: .45 })
  expect(again.curves!.scale!.find(v => v.time === point.time)).toEqual(changed.curves!.scale!.find(v => v.time === point.time))
  for (const edited of [sliceVideoEditClipKeyframes(generated, 60, 240), rescaleVideoEditClipKeyframes(generated, time => Math.round(time / 2), 300)]) {
    expect(edited.curves!.scale!.every(v => isVideoEditMotionKeyframe(v, 'screen_attention'))).toBe(true)
  }
})
it('同一事件在9:16和1:1画幅内取景，沿用4倍缩放范围；段落校验拒绝越序与重叠', () => {
  for (const target of [{ width: 1080, height: 1920 }, { width: 1080, height: 1080 }]) {
    const result = draft([click(1e6)], target)
    expect(result.curves!.scale!.every(v => typeof v.value === 'number' && v.value <= 4)).toBe(true)
    expect(evaluateVideoEditKeyframes(result.curves!.x, 120, 0)).toBeLessThan(0)
  }
  expect(screenAttentionSettingsSchema.safeParse({ sections: [{ startSeconds: 2, endSeconds: 1, strength: 'light' }] }).success).toBe(false)
  expect(screenAttentionSettingsSchema.safeParse({ sections: [{ startSeconds: 0, endSeconds: 2, strength: 'light' }, { startSeconds: 1, endSeconds: 3, strength: 'strong' }] }).success).toBe(false)
})
it('60分钟60fps/120Hz的真实事件与输出规模可计算，生成结果受现有范围和误差约束', () => {
  const duration = 3600 * 60
  const events: CaptureEvent[] = Array.from({ length: 3600 * 120 }, (_, i) => ({ kind: 'cursor', eventId: String(i), seq: i, recordingUs: Math.round(i * 1e6 / 120), monoUs: Math.round(i * 1e6 / 120), clockSegmentRef: 'clock', timeline: null, unavailableReason: 'static', shape: 'arrow', point: [500 + i % 100, 500] }))
  const times = Array.from({ length: duration }, (_, frame) => frame * 1e6 / 60)
  const samples = sampleScreenAttention(events, times, picture, picture, settings)
  const result = generateVideoEditReframeKeyframes({ ...clip, duration }, samples.map(v => v.box), picture, picture, 60, { attention: 'auto', motion: 'default' }, [], { source: 'screen_attention', zoom: samples.map(v => v.zoom), transitionSeconds: .45 })
  expect(samples).toHaveLength(216000)
  expect(result.curves!.scale!.length).toBeLessThan(1000)
  expect(result.curves!.scale!.every(v => typeof v.value === 'number' && v.value <= 4)).toBe(true)
}, 20000)
