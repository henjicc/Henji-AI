import { z } from 'zod'
import type { CapturePayload, cursorShapes } from '../captureLog/events'
import type { WebRecordingBehaviorEvent, WebRecordingManifest } from './schema'

/**
 * 网页录制进剪辑：把行为轨（页面 CSS 像素、页面时钟 t µs）换算成视频里的位置与时间，投影成屏幕录制同一套
 * 采集事件（光标、点击、滚动、按键），交给现有的鼠标效果与自动缩放。
 *
 * 两种视频：
 * - 重演视频 replay-*.mp4：从页面零点开始逐帧渲染（player.ts 第 i 帧 = zeroMs + i/fps），视频秒数 = t / 1e6；
 *   画面是 viewport × dpr 的设备像素，不画光标。
 * - 备份录屏 backup.mp4：与页面零点用 Henji 单调时钟对齐。视频秒数 =
 *   (clock.monoAtZeroUs + t − (backup.originUs + span.monoUs)) / 1e6，多段时加上前面各段的时长；
 *   落在段与段之间的事件丢弃。应用窗口录屏正好是页面内容区（2240×1436 = 1280×821 × 1.75），已带光标。
 */

/** backup.json：备份录屏各段在 Henji 单调时钟上的位置（originUs 为采集开始，段 monoUs 相对它）。无版本字段，按 1 登记。 */
export const WEB_RECORDING_BACKUP_TIMING_VERSION = 1
export const webRecordingBackupTimingSchema = z.object({
  originUs: z.number().finite(),
  spans: z.array(z.object({ monoUs: z.number().finite(), durationUs: z.number().finite().nonnegative() }).strict()),
}).strict()
export type WebRecordingBackupTiming = z.infer<typeof webRecordingBackupTimingSchema>

export type WebRecordingVideoClock = { kind: 'replay' } | { kind: 'backup'; monoAtZeroUs: number; timing: WebRecordingBackupTiming }

/** 页面时间 t（µs）在视频里的时间（µs）；不在视频里（录屏开始前、段与段之间、或没有时钟）时为 null。 */
export function pageTimeToVideoUs(clock: WebRecordingVideoClock, t: number): number | null {
  if (clock.kind === 'replay') return t
  const mono = clock.monoAtZeroUs + t
  let before = 0
  for (const span of clock.timing.spans) {
    const start = clock.timing.originUs + span.monoUs
    if (mono >= start && mono < start + span.durationUs) return Math.round(before + mono - start)
    before += span.durationUs
  }
  return null
}

export interface WebRecordingVideoFrame { width: number; height: number }

/**
 * 页面 CSS 像素 → 视频像素的缩放。视频与页面比例不符（备份录的是整个屏幕，看不出窗口在哪）时返回 null，
 * 这种视频不能画回光标与点击位置。
 */
export function pageToVideoScale(viewport: { width: number; height: number }, video: WebRecordingVideoFrame): { x: number; y: number } | null {
  const x = video.width / viewport.width
  const y = video.height / viewport.height
  return Math.abs(x - y) / Math.max(x, y) <= 0.02 ? { x, y } : null
}

type Pointer = Extract<WebRecordingBehaviorEvent, { kind: 'pointer' }>
type Key = Extract<WebRecordingBehaviorEvent, { kind: 'key' }>
type Shape = (typeof cursorShapes)[number]

const ALT = 1, CTRL = 2, META = 4, SHIFT = 8
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Unidentified', 'Process'])
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'])

/** 按键归类（与屏幕录制同一套类别）；单按修饰键、输入法组字与重复按下不算一次操作。 */
export function webKeyCategory(event: Key): Extract<CapturePayload, { kind: 'key' }>['category'] | null {
  if (event.type !== 'down' || event.repeat || event.composing || MODIFIER_KEYS.has(event.key)) return null
  const command = (event.mods & (CTRL | META)) !== 0
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (command) {
    if (key === 'c') return 'copy'
    if (key === 'v') return 'paste'
    if (key === 'x') return 'cut'
    if (key === 'z') return event.mods & SHIFT ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    if (key === 'a') return 'select-all'
    return 'shortcut'
  }
  if (key === 'Enter') return 'confirm'
  if (key === 'Escape') return 'cancel'
  if (NAVIGATION_KEYS.has(key)) return 'navigation'
  if (event.mods & ALT || /^F\d{1,2}$/.test(key)) return 'shortcut'
  return 'typing'
}

/** 指针下面是什么：输入框显示文本光标，按钮与链接显示手形。 */
function pointerShape(event: Pointer): Shape {
  const locator = event.target?.locator
  if (!locator) return 'arrow'
  if (locator.tag === 'textarea' || locator.tag === 'input' || locator.role === 'textbox' || locator.role === 'searchbox') return 'text'
  if (locator.tag === 'a' || locator.tag === 'button' || locator.role === 'button' || locator.role === 'link' || locator.role === 'tab' || locator.role === 'menuitem') return 'hand'
  return 'arrow'
}

const BUTTONS = ['left', 'middle', 'right'] as const

export interface ProjectedVideoEvent { videoUs: number; payload: CapturePayload }

/**
 * 行为轨 → 视频时间上的采集事件（按时间排序）。缩放为 null 时只投影按键（位置无从换算）。
 * 页面尺寸变化（resize）后按新尺寸换算。
 */
export function projectWebRecordingEvents(manifest: Pick<WebRecordingManifest, 'env'>, events: readonly WebRecordingBehaviorEvent[], clock: WebRecordingVideoClock, video: WebRecordingVideoFrame & { durationUs: number }): ProjectedVideoEvent[] {
  let viewport = { width: manifest.env.viewport.width, height: manifest.env.viewport.height }
  let scale = pageToVideoScale(viewport, video)
  const result: ProjectedVideoEvent[] = []
  const point = (x: number, y: number): [number, number] => [Math.round(x * scale!.x * 100) / 100, Math.round(y * scale!.y * 100) / 100]
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    if (event.kind === 'resize') { viewport = { width: event.width, height: event.height }; scale = pageToVideoScale(viewport, video); continue }
    const videoUs = pageTimeToVideoUs(clock, event.t)
    if (videoUs === null || videoUs < 0 || videoUs > video.durationUs) continue
    if (event.kind === 'key') {
      const category = webKeyCategory(event)
      if (category) result.push({ videoUs, payload: { kind: 'key', category } })
      continue
    }
    if (!scale) continue
    if (event.kind === 'pointer') {
      const at = point(event.x, event.y)
      if (event.type === 'up') { const button = BUTTONS[event.button] ?? 'other'; result.push({ videoUs, payload: { kind: 'click', point: at, button, phase: 'up' } }) }
      result.push({ videoUs, payload: { kind: 'cursor', point: at, shape: pointerShape(event) } })
      if (event.type === 'down') result.push({ videoUs, payload: { kind: 'click', point: at, button: BUTTONS[event.button] ?? 'other', phase: 'down' } })
    } else if (event.kind === 'wheel') {
      const vertical = Math.abs(event.dy) >= Math.abs(event.dx)
      result.push({ videoUs, payload: { kind: 'scroll', point: point(event.x, event.y), axis: vertical ? 'vertical' : 'horizontal', amount: vertical ? event.dy : event.dx } })
    }
  }
  return result
}
