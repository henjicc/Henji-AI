import { z } from 'zod'
import type { CaptureEvent } from '../captureLog/events'
import type { VideoEditSize } from './clipGeometry'
import { videoEditReframeViewport, type VideoEditAttentionBox } from './reframe'

const strength = z.enum(['light', 'medium', 'strong'])
export const screenAttentionSettingsSchema = z.object({
  strength: strength.default('medium'),
  minimumStaySeconds: z.number().min(0.4).max(4).default(1.2),
  transitionSeconds: z.number().min(0.15).max(2).default(0.45),
  sections: z.array(z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(), strength }).strict())
    .max(200).default([]).superRefine((sections, ctx) => {
      sections.forEach((section, i) => {
        if (section.endSeconds <= section.startSeconds || i > 0 && section.startSeconds < sections[i - 1].endSeconds) ctx.addIssue({ code: 'custom', path: [i], message: '段落须按片段内秒升序排列，起点小于终点且不能重叠。' })
      })
    }),
}).strict()
export type ScreenAttentionSettings = z.infer<typeof screenAttentionSettingsSchema>
/** Optional capture-time regions, in normalized captured-picture coordinates. Never query today's DOM for yesterday's recording. */
export interface ScreenAttentionRegion { eventId: string; box: VideoEditAttentionBox }
export interface ScreenAttentionSample { box: VideoEditAttentionBox | null; zoom: number }
export const SCREEN_ATTENTION_STRENGTH = { light: 1.35, medium: 1.8, strong: 2.4 } as const
export function screenAttentionZoom(box: VideoEditAttentionBox | null, viewport: VideoEditSize, strength: ScreenAttentionSettings['strength']): number {
  return box ? Math.max(1, Math.min(SCREEN_ATTENTION_STRENGTH[strength], viewport.width / box.width, viewport.height / box.height)) : 1
}
interface Focus { box: VideoEditAttentionBox; at: number; until: number; priority: number }
export const SCREEN_ATTENTION_LOOKBACK_US = 8_000_000

function region(box: VideoEditAttentionBox): VideoEditAttentionBox | null {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw new Error('录制关注框无效，请修正捕获时的区域。')
  if (box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= 1) return { ...box }
  const x = Math.max(0, box.x); const y = Math.max(0, box.y)
  const right = Math.min(1, box.x + box.width); const bottom = Math.min(1, box.y + box.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}
function around(point: readonly [number, number], picture: VideoEditSize, typing = false): VideoEditAttentionBox | null {
  if (point[0] < 0 || point[1] < 0 || point[0] >= picture.width || point[1] >= picture.height) return null
  const width = typing ? 0.4 : 0.22; const height = typing ? 0.16 : 0.22
  return region({ x: point[0] / picture.width - width / 2, y: point[1] / picture.height - height / 2, width, height })
}
function close(a: VideoEditAttentionBox, b: VideoEditAttentionBox): boolean {
  return Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2) < 0.04
}

/** Single chronological scan; output may be requested in reverse order after source-clock mapping. */
export function sampleScreenAttention(events: readonly CaptureEvent[], timesUs: readonly number[], picture: VideoEditSize, target: VideoEditSize, settings: ScreenAttentionSettings, regions: readonly ScreenAttentionRegion[] = []): ScreenAttentionSample[] {
  const viewport = videoEditReframeViewport(picture, target)
  const precise = new Map(regions.map(value => [value.eventId, region(value.box)]))
  const ordered = timesUs.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time)
  const result: ScreenAttentionSample[] = new Array(timesUs.length)
  const focuses = new Map<number, Focus>(); let chosen: Focus | undefined; let selectedAt = -Infinity
  let cursor: Extract<CaptureEvent, { kind: 'cursor' }> | undefined; let lastClick: Extract<CaptureEvent, { kind: 'click' }> | undefined
  let dwell: { box: VideoEditAttentionBox; since: number; last: number } | undefined
  let typingAt = -Infinity; let typingCount = 0; let windowBox: VideoEditAttentionBox | null = null; let eventIndex = 0
  const stayUs = settings.minimumStaySeconds * 1_000_000
  const offer = (box: VideoEditAttentionBox | null | undefined, event: CaptureEvent, priority: number): void => {
    if (box) focuses.set(priority, { box, at: event.recordingUs, until: event.recordingUs + Math.max(stayUs, 2_000_000), priority })
  }
  const choose = (time: number): void => {
    const candidate = [...focuses.values()].filter(value => value.until >= time).sort((a, b) => b.priority - a.priority || b.at - a.at)[0]
    if (!candidate) chosen = undefined
    else if (!chosen || chosen.until < time || candidate.priority > chosen.priority || time - selectedAt >= stayUs || close(candidate.box, chosen.box)) {
      if (!chosen || !close(candidate.box, chosen.box)) selectedAt = time
      chosen = candidate
    }
  }
  for (const { time, index } of ordered) {
    while (eventIndex < events.length && events[eventIndex].recordingUs <= time) {
      const e = events[eventIndex++]
      if (e.kind === 'control') {
        focuses.clear(); chosen = undefined; dwell = undefined; cursor = undefined; lastClick = undefined; windowBox = null; typingCount = 0; typingAt = -Infinity
      } else if (e.kind === 'cursor') {
        cursor = e
        const box = e.point && e.shape !== 'hidden' ? around(e.point, picture) : null
        if (!box) dwell = undefined
        else if (!dwell || e.recordingUs - dwell.last > 100_000 || !close(box, dwell.box)) dwell = { box, since: e.recordingUs, last: e.recordingUs }
        else {
          dwell.last = e.recordingUs
          if (e.recordingUs - dwell.since >= stayUs) offer(dwell.box, e, 1)
        }
      } else if (e.kind === 'click' && e.phase === 'down') {
        lastClick = e; typingCount = 0
        offer(precise.get(e.eventId) ?? around(e.point, picture), e, 3)
      } else if (e.kind === 'scroll' && e.amount !== 0) offer(around(e.point, picture), e, 2)
      else if (e.kind === 'key' && e.category === 'typing') {
        typingCount = e.recordingUs - typingAt <= 800_000 ? typingCount + 1 : 1; typingAt = e.recordingUs
        const point = cursor?.shape === 'text' && cursor.point && e.recordingUs - cursor.recordingUs <= 200_000 ? cursor.point : lastClick && e.recordingUs - lastClick.recordingUs <= SCREEN_ATTENTION_LOOKBACK_US ? lastClick.point : null
        if (typingCount >= 2) offer(precise.get(e.eventId) ?? (point ? around(point, picture, true) : null), e, 4)
      } else if (e.kind === 'window') {
        const b = e.available ? e.bounds : null
        windowBox = b ? region({ x: b.x / picture.width, y: b.y / picture.height, width: b.width / picture.width, height: b.height / picture.height }) : null
        focuses.delete(0); offer(windowBox, e, 0)
      } else if (e.kind === 'capability' && e.phase === 'started') {
        const point = cursor?.point && e.recordingUs - cursor.recordingUs <= 200_000 ? cursor.point : lastClick && e.recordingUs - lastClick.recordingUs <= 2_000_000 ? lastClick.point : null
        offer(precise.get(e.eventId) ?? (point ? around(point, picture) : windowBox), e, 5)
      }
      choose(e.recordingUs)
    }
    choose(time)
    const box = chosen?.box ?? null
    const zoom = screenAttentionZoom(box, viewport, settings.strength)
    result[index] = { box, zoom }
  }
  return result
}
