import { activeVideoEditEffects } from './compositing'
import { videoEditClipSpeedRange } from './clipSpeed'
import { videoEditRenderWindowClips, videoEditRenderWindowInputs } from './renderCache'
import type { VideoEditClip, VideoEditComposition } from './document'

/**
 * 预渲染调度用的“吃力”判断：只决定哪些窗口值得先渲、哪些可以实时播放，不影响预览文件的内容。
 * 它不在预渲染引擎版本的散列范围里（见 scripts/vite/renderEngineVersion.mjs），调整判断不会让已有预览文件失效；
 * 这里也不能被合成、指纹或编码代码引用，否则会被重新卷进散列。
 */

/**
 * 多机位片段实际显示的那一路：所选机位在源序列里的素材片段。节目只解这一路（见 videoEditNestedComposition），
 * 所以它和一段普通视频一样轻；其他嵌套序列返回 undefined。
 */
function multicamPicture(document: VideoEditComposition, clip: VideoEditClip): VideoEditClip | undefined {
  if (clip.kind !== 'sequence') return undefined
  const item = document.items.find(value => value.id === clip.itemId)
  const sequence = document.sequences?.find(value => value.id === item?.sequenceId)
  if (!sequence?.multicam) return undefined
  const camera = sequence.multicam.cameras.find(value => value.id === (clip.multicamCameraId ?? sequence.multicam!.cameras[0]?.id))
  return camera && sequence.clips.find(value => value.id === camera.clipId)
}
/**
 * 变速里吃力的只有快放与倒放：快放要跳着解（每个时间线帧解多帧源画面），倒放要逆着长 GOP 回溯；
 * 慢放是顺序解，比原速还轻。定格（含时间重映射加定格）只解一帧，先排除。时间重映射没有负速度，倒放只看 reverse。
 */
const retimed = (clip: VideoEditClip): boolean => !clip.frameHold && (Boolean(clip.reverse) || videoEditClipSpeedRange(clip).max > 1 + 1e-9)
/**
 * 窗口里可能吃力的画面：代码片段与代码效果、嵌套序列（多机位按所选那一路算）、转场、三层以上画面，以及变速、倒放和时间重映射
 * （快放跳着解、倒放逆着长 GOP 解，比顺序解一路原片重得多；慢放与定格不算）。实际播放测得掉帧也算（由调用方标注）。
 */
function heavyClips(document: VideoEditComposition, clips: readonly VideoEditClip[], transitions: number): boolean {
  if (transitions > 0) return true
  if (clips.filter(clip => clip.kind !== 'text').length >= 3) return true
  return clips.some(clip => {
    const picture = multicamPicture(document, clip)
    if (clip.kind === 'sequence' && !picture) return true
    return [clip, ...(picture ? [picture] : [])].some(value => value.kind === 'code' || value.kind === 'graphic' || retimed(value) || activeVideoEditEffects(value).some(effect => effect.code))
  })
}

/** 每个窗口是否预计吃力，与传入的窗口一一对应；片段选取与窗口指纹用同一份。 */
export function videoEditRenderWindowsHeavy(document: VideoEditComposition, windows: readonly { startFrame: number; endFrame: number }[]): boolean[] {
  const inputs = videoEditRenderWindowInputs(document)
  return windows.map(({ startFrame, endFrame }) => {
    const { clips, transitions } = videoEditRenderWindowClips(inputs, startFrame, endFrame)
    return heavyClips(document, clips, transitions.length)
  })
}
