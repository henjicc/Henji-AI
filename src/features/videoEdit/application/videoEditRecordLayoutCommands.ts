import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { videoEditRecordingLane } from '@/core/videoEdit/recordingLane'
import { getActiveVideoEditSequence, videoEditLayout, videoEditRecordingInProgress, type VideoEditInstance } from './videoEditService'

/** 录制样子里照常响应的剪辑命令：播放、逐帧、上一段下一段、首尾、撤销重做。 */
const RECORD_LAYOUT_COMMANDS = new Set<VideoEditCommandId>(['play_pause', 'play_reverse', 'play_stop', 'play_forward', 'step_back', 'step_forward', 'step_back_five', 'step_forward_five', 'go_prev_edit', 'go_next_edit', 'go_start', 'go_end', 'undo', 'redo'])
/**
 * 剪辑命令在录制样子里怎么处理（快捷键与菜单共用这一份判断）：`edit` 不在录制样子，照剪辑的规则；`pass` 照常执行；
 * `lane` 换成录屏轨上的同名操作（切开、删除）；`blocked` 不响应，带原因。录制中一律不响应。
 */
export type VideoEditRecordLayoutCommand = { kind: 'edit' } | { kind: 'pass' } | { kind: 'lane'; run: () => Promise<void> } | { kind: 'blocked'; reason: string }
export function videoEditRecordLayoutCommand(instance: VideoEditInstance | undefined, id: VideoEditCommandId): VideoEditRecordLayoutCommand {
  if (!instance || videoEditLayout(instance) !== 'record') return { kind: 'edit' }
  if (videoEditRecordingInProgress(instance)) return { kind: 'blocked', reason: '正在录制，停止后再操作。' }
  if (RECORD_LAYOUT_COMMANDS.has(id)) return { kind: 'pass' }
  const projectId = instance.document.id
  // 判断只读状态；真正的编辑在执行时才加载（菜单每次刷新都要判断，不为它拉起整套时间线编辑）。
  const lane = videoEditRecordingLane(getActiveVideoEditSequence(instance))
  if (id === 'split') return lane.blocks.some(({ clip }) => instance.frame > clip.start && instance.frame < clip.start + clip.duration) ? { kind: 'lane', run: async () => (await import('./videoEditRecordingLane')).splitVideoEditRecordingAtPlayhead(projectId) } : { kind: 'blocked', reason: '把指针放在某一段中间再切开。' }
  if (id === 'delete' || id === 'ripple_delete') {
    const selected = lane.blocks.find(({ clip }) => clip.id === instance.selection)
    return selected ? { kind: 'lane', run: async () => (await import('./videoEditRecordingLane')).deleteVideoEditRecordingBlock(projectId, selected.clip.id) } : { kind: 'blocked', reason: '先在录屏轨上选中一段。' }
  }
  return { kind: 'blocked', reason: '录制样子里只能播放、切开、删除和撤销；其余操作切到“剪辑”再用。' }
}
