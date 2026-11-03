import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_DEFAULT_SPACE_DISPLAY, VIDEO_EDIT_SPACE_DISPLAY_STEPS, videoEditSpaceDisplaySchema, type VideoEditSpaceDisplaySetting, type VideoEditSpaceRenderDisplay } from '@/core/videoEdit/spaceDisplay'
import { publishVideoEdit, requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.spaceDisplay')
/** 按剪辑记住的三维显示方式（本机视图偏好，不写进剪辑文件、不进撤销栈）。最多记住最近 200 份剪辑。 */
const STORAGE_KEY = 'videoEdit.spaceDisplay.v1'
const MAX_REMEMBERED = 200
/**
 * 自动简化：每看完这么多个播放目标帧算一次掉帧比例，超过 SIMPLIFY_DROP_RATIO 降一档；
 * 掉帧不超过 RESTORE_DROP_RATIO（零星掉一帧也算稳定）且这一档已满 RESTORE_AFTER_MS 时试着升回一档。
 * 降得快、升得慢，不在两档之间来回跳；暂停时清零，下次起播从实时重新判断。
 */
const WINDOW_FRAMES = 30
const SIMPLIFY_DROP_RATIO = .1
const RESTORE_DROP_RATIO = .02
const RESTORE_AFTER_MS = 4000
let remembered: Map<string, VideoEditSpaceDisplaySetting> | undefined
interface AutoState { level: number; frames: number; dropped: number; changedAt: number }
const auto = new Map<string, AutoState>()

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
function load(): Map<string, VideoEditSpaceDisplaySetting> {
  if (remembered) return remembered
  remembered = new Map()
  try {
    const raw: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [projectId, value] of Object.entries(raw)) {
      const parsed = videoEditSpaceDisplaySchema.safeParse(value)
      if (parsed.success) remembered.set(projectId, parsed.data)
    }
  } catch { /* 偏好损坏时回到默认值 */ }
  return remembered
}
function persist(values: Map<string, VideoEditSpaceDisplaySetting>): void {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(values))) } catch (error) { logger.debug('三维显示方式偏好未能写入本机', { event: 'video_edit.space_display.persist_failed', error }) }
}

/** 当前选择（没选过为自动）。只读偏好，剪辑关闭后仍可读，不抛错。 */
export function getVideoEditSpaceDisplay(projectId: string): VideoEditSpaceDisplaySetting {
  return { ...(load().get(projectId) ?? VIDEO_EDIT_DEFAULT_SPACE_DISPLAY) }
}

/** 界面与助手共用的唯一写入口：校验后记住并通知节目监视器。换方式时自动简化从头算。 */
export function setVideoEditSpaceDisplay(projectId: string, value: Partial<VideoEditSpaceDisplaySetting>): VideoEditSpaceDisplaySetting {
  requireVideoEditInstance(projectId)
  const next = videoEditSpaceDisplaySchema.parse({ ...getVideoEditSpaceDisplay(projectId), ...value })
  const values = load()
  if ((values.get(projectId) ?? VIDEO_EDIT_DEFAULT_SPACE_DISPLAY).mode === next.mode) return next
  values.delete(projectId); values.set(projectId, next)
  while (values.size > MAX_REMEMBERED) values.delete(values.keys().next().value!)
  persist(values)
  auto.delete(projectId)
  logger.info('三维显示方式已更改', { event: 'video_edit.space_display.changed', context: { projectId, mode: next.mode } })
  publishVideoEdit()
  return next
}

/**
 * 节目监视器此刻用哪种显示方式渲染：选了固定方式就用它；自动在播放时按跟不跟得上逐级简化，暂停时回到实时。
 * 渲染（路径追踪）一帧要几秒，追踪期间显卡被占住：播放、拖动以及停下后还没停稳（`moving`）时按实时显示，停稳才追踪。
 */
export function effectiveVideoEditSpaceDisplay(projectId: string, playing: boolean, moving = playing): VideoEditSpaceRenderDisplay {
  const { mode } = getVideoEditSpaceDisplay(projectId)
  if (mode === 'render' && (playing || moving)) return 'realtime'
  if (mode !== 'auto') return mode
  if (!playing) { auto.delete(projectId); return 'realtime' }
  return VIDEO_EDIT_SPACE_DISPLAY_STEPS[auto.get(projectId)?.level ?? 0]
}

/** 自动方式下播放时是否已简化（节目监视器据此提示“预览已简化”）。 */
export function videoEditSpaceDisplaySimplified(projectId: string, playing: boolean): boolean {
  return playing && getVideoEditSpaceDisplay(projectId).mode === 'auto' && (auto.get(projectId)?.level ?? 0) > 0
}

/**
 * 播放循环每推进一次报一次：这次要的目标帧数与其中掉了几帧（只在这一帧有三维片段时报）。
 * 返回是否换了档，换档时通知界面刷新提示。
 */
export function noteVideoEditSpacePlayback(projectId: string, frames: number, dropped: number, now = performance.now()): boolean {
  if (getVideoEditSpaceDisplay(projectId).mode !== 'auto' || frames <= 0) return false
  const state = auto.get(projectId) ?? { level: 0, frames: 0, dropped: 0, changedAt: now }
  auto.set(projectId, state)
  state.frames += frames; state.dropped += dropped
  if (state.frames < WINDOW_FRAMES) return false
  const ratio = state.dropped / state.frames
  state.frames = 0; state.dropped = 0
  const previous = state.level
  if (ratio > SIMPLIFY_DROP_RATIO && state.level < VIDEO_EDIT_SPACE_DISPLAY_STEPS.length - 1) state.level++
  else if (ratio <= RESTORE_DROP_RATIO && state.level > 0 && now - state.changedAt >= RESTORE_AFTER_MS) state.level--
  if (state.level === previous) return false
  state.changedAt = now
  logger.info('三维预览自动换档', { event: 'video_edit.space_display.auto_changed', context: { projectId, display: VIDEO_EDIT_SPACE_DISPLAY_STEPS[state.level], dropRatio: ratio } })
  publishVideoEdit()
  return true
}

/** 仅测试：清掉内存里的偏好与自动简化状态。 */
export function resetVideoEditSpaceDisplayCache(): void { remembered = undefined; auto.clear() }
