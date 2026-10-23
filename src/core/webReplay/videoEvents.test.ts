import { describe, expect, it } from 'vitest'
import { pageTimeToVideoUs, pageToVideoScale, projectWebRecordingEvents, webKeyCategory } from './videoEvents'
import type { WebRecordingBehaviorEvent } from './schema'

const env = { env: { url: 'http://tauri.localhost/', viewport: { width: 1280, height: 821, dpr: 1.75 }, colorScheme: 'light' as const, reducedMotion: false, locale: 'zh-CN', timeZone: 'Asia/Shanghai', userAgent: 'test' } }
// 真实录制「开头演示」的时钟：备份录屏比页面零点晚 0.632 s 开始采集，第一段再晚 0.666 s。
const backup = { kind: 'backup' as const, monoAtZeroUs: 165773889049, timing: { originUs: 165774521332, spans: [{ monoUs: 666267, durationUs: 10_000_000 }, { monoUs: 20_000_000, durationUs: 5_000_000 }] } }

describe('网页录制的视频时钟', () => {
  it('重演视频从页面零点开始，视频时间等于页面时间', () => {
    expect(pageTimeToVideoUs({ kind: 'replay' }, 1_525_700)).toBe(1_525_700)
  })
  it('备份录屏按 (monoAtZero + t − (origin + span.mono)) 换算，多段时加上前面各段时长，段外的丢弃', () => {
    const firstSpanStartT = 165774521332 + 666267 - 165773889049
    expect(pageTimeToVideoUs(backup, firstSpanStartT)).toBe(0)
    expect(pageTimeToVideoUs(backup, firstSpanStartT + 2_000_000)).toBe(2_000_000)
    expect(pageTimeToVideoUs(backup, firstSpanStartT - 1)).toBeNull()
    expect(pageTimeToVideoUs(backup, firstSpanStartT + 12_000_000)).toBeNull()
    const secondSpanStartT = 165774521332 + 20_000_000 - 165773889049
    expect(pageTimeToVideoUs(backup, secondSpanStartT + 1_000_000)).toBe(11_000_000)
  })
})

describe('网页录制的画面坐标', () => {
  it('应用窗口录屏正好是页面内容区：1280×821 CSS 像素 × 1.75 = 2240×1436', () => {
    const scale = pageToVideoScale(env.env.viewport, { width: 2240, height: 1436 })!
    expect(scale.x).toBeCloseTo(1.75, 3)
    expect(scale.y).toBeCloseTo(1.749, 2)
  })
  it('整个屏幕的备份比例对不上，不能换算位置', () => {
    expect(pageToVideoScale(env.env.viewport, { width: 3840, height: 2160 })).toBeNull()
  })
})

describe('行为轨投影成采集事件', () => {
  const events: WebRecordingBehaviorEvent[] = [
    { kind: 'pointer', t: 1_000_000, type: 'move', x: 100, y: 50, button: -1, buttons: 0, clickCount: 0, pointerType: 'mouse', mods: 0 },
    { kind: 'pointer', t: 1_200_000, type: 'down', x: 400, y: 300, button: 0, buttons: 1, clickCount: 1, pointerType: 'mouse', mods: 0, target: { locator: { tag: 'textarea', path: 'textarea', role: 'textbox' }, rect: { x: 0, y: 0, width: 10, height: 10 }, offset: [0.5, 0.5] } },
    { kind: 'pointer', t: 1_250_000, type: 'up', x: 400, y: 300, button: 0, buttons: 0, clickCount: 1, pointerType: 'mouse', mods: 0 },
    { kind: 'wheel', t: 1_300_000, x: 400, y: 300, dx: 0, dy: 120, mods: 0 },
    { kind: 'key', t: 1_400_000, type: 'down', key: 'v', code: 'KeyV', keyCode: 86, location: 0, repeat: false, mods: 2, composing: false },
    { kind: 'key', t: 1_410_000, type: 'down', key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1, repeat: false, mods: 2, composing: false },
    { kind: 'text', t: 1_500_000, data: '交换机' },
    { kind: 'pointer', t: 99_000_000, type: 'move', x: 1, y: 1, button: -1, buttons: 0, clickCount: 0, pointerType: 'mouse', mods: 0 },
  ]
  it('重演视频：位置按设备像素放大，点击先光标后按下、先抬起后光标，超出视频时长的丢弃', () => {
    const projected = projectWebRecordingEvents(env, events, { kind: 'replay' }, { width: 2240, height: 1437, durationUs: 10_000_000 })
    expect(projected.map(event => event.payload.kind)).toEqual(['cursor', 'cursor', 'click', 'click', 'cursor', 'scroll', 'key'])
    expect(projected[1]).toEqual({ videoUs: 1_200_000, payload: { kind: 'cursor', point: [700, 525.09], shape: 'text' } })
    expect(projected[2].payload).toMatchObject({ kind: 'click', phase: 'down', button: 'left' })
    expect(projected[5].payload).toMatchObject({ kind: 'scroll', axis: 'vertical', amount: 120 })
    expect(projected[6].payload).toEqual({ kind: 'key', category: 'paste' })
  })
  it('画面对不上时只留按键', () => {
    const projected = projectWebRecordingEvents(env, events, { kind: 'replay' }, { width: 3840, height: 2160, durationUs: 10_000_000 })
    expect(projected.map(event => event.payload.kind)).toEqual(['key'])
  })
  it('按键归类沿用屏幕录制的类别', () => {
    const key = (key: string, mods = 0) => webKeyCategory({ kind: 'key', t: 0, type: 'down', key, code: '', keyCode: 0, location: 0, repeat: false, mods, composing: false })
    expect([key('a'), key('Enter'), key('Escape'), key('ArrowLeft'), key('z', 2), key('z', 10), key('s', 4), key('Shift')]).toEqual(['typing', 'confirm', 'cancel', 'navigation', 'undo', 'redo', 'shortcut', null])
  })
})
