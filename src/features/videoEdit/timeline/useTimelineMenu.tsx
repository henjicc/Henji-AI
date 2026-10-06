import { videoEditMulticamSource } from '@/core/videoEdit/multicam'
import { switchVideoEditMulticam, autoSwitchVideoEditMulticam } from '../application/videoEditMulticam'
import { Crop, Copy, Clipboard, Scissors, Trash2, Link2, Unlink, Group, Ungroup, Locate, Play, SlidersHorizontal, AudioLines, ArrowRightToLine, ListChecks, MoveHorizontal, ChevronsLeftRight, Undo2, Gauge } from 'lucide-react'
import { expandVideoEditSelection, videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { setVideoEditTimelineView, type VideoEditInstance } from '../application/videoEditService'
import { timelineCommandPresentation } from './timelineCommandPresentation'
import { videoEditClipMedia } from '@/core/videoEdit/document'
import type { VideoEditAudioChannelsTarget } from '../panels/VideoEditAudioChannelsDialog'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import type { VideoEditInPlaceMenuTarget } from './useVideoEditInPlaceMenu'
import type { VideoEditSceneTarget } from '../application/videoEditSceneDetection'
import { useState } from 'react'
import { ICON_WORKSPACE_CANVAS } from '@/core/theme/icons'
import { VideoEditCanvasSendDialog, type VideoEditCanvasSendRequest } from '../panels/VideoEditCanvasSendDialog'
import type { VideoEditNestTarget } from '../application/videoEditNesting'

const actionIcons = { audio_gain: AudioLines, clip_speed: Gauge, copy: Copy, paste: Clipboard, insert: ArrowRightToLine, overwrite: Clipboard, split: Scissors, split_tracks: Scissors, delete: Trash2, ripple_delete: Trash2, link: Link2, unlink: Unlink, group: Group, ungroup: Ungroup, separate_audio: AudioLines, locate_source: Play, locate_project: Locate, locate_effects: SlidersHorizontal, select_all: ListChecks, move_into_sync: MoveHorizontal, slip_into_sync: ChevronsLeftRight } as const
type MenuCommand = keyof typeof actionIcons

/** 原地生成（4.12）：按右键落点（轨道、帧、片段）给出菜单最前面的生成项。 */
export interface TimelineInPlaceMenu { items(target: VideoEditInPlaceMenuTarget): MenuItem[]; frameAt(clientX: number): number | null }
export function useTimelineMenu(instance: VideoEditInstance, onError: (error: unknown) => void, cancelPointer: () => void, onAudioChannels?: (target: VideoEditAudioChannelsTarget) => void, onOpenSource?: (clipId: string) => void, inPlace?: TimelineInPlaceMenu, onScenes?: (target: VideoEditSceneTarget) => void, onReframe?: (target: VideoEditSceneTarget) => void, onNest?: (target: VideoEditNestTarget) => void) {
  const menu = useContextMenu()
  const [canvasSend, setCanvasSend] = useState<VideoEditCanvasSendRequest | null>(null)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const show = (event: React.MouseEvent): void => {
    // 浮窗中的目标属于子窗口 realm，不能用 instanceof Element 判定。
    const target = elementOfEventTarget(event.target)
    if (!target || target.closest('[data-video-edit-track-header]')) return
    cancelPointer()
    try {
      const clipId = target.closest('[data-video-edit-clip]')?.getAttribute('data-video-edit-clip')
      const trackId = target.closest('[data-video-edit-track]')?.getAttribute('data-video-edit-track')
      const sequence = instance.document.sequences.find(value => value.id === instance.activeSequenceId)!
      // Right-clicking an unselected clip picks it like a left click (Linked Selection and groups; Alt singles it out).
      const ids = clipId ? instance.selectedClipIds.includes(clipId) ? [clipId, ...instance.selectedClipIds.filter(id => id !== clipId)] : [clipId, ...expandVideoEditSelection(sequence, [clipId], videoEditPickRelations(instance.linkedSelection !== false, event.altKey)).filter(id => id !== clipId)] : []
      if (clipId) setVideoEditTimelineView(instance.document.id, { selectedClipIds: ids }, clipId)
      // Freeze at menu opening. The shared menu executes its callback after closing, not at this event.
      const context = captureVideoEditCommandContext(instance.document.id, 'timeline', { clipIds: ids })
      const optional = (id: MenuCommand): MenuCommand[] => videoEditCommandState(context, id).enabled ? [id] : []
      const commands: MenuCommand[] = clipId ? ['locate_source', 'locate_project', 'locate_effects', ...optional('clip_speed'), ...optional('audio_gain'), 'copy', 'paste', 'split', 'split_tracks', 'delete', 'ripple_delete', 'link', ...optional('unlink'), 'group', ...optional('ungroup'), 'separate_audio', ...optional('move_into_sync'), ...optional('slip_into_sync')] : ['paste', 'insert', 'overwrite', 'select_all']
      const dividers = new Set<VideoEditCommandId>(['locate_effects', 'paste', 'split_tracks', 'ripple_delete', 'ungroup', 'separate_audio'])
      const items: MenuItem[] = commands.map(id => {
        const presentation = timelineCommandPresentation(context, id, shortcuts); const Icon = actionIcons[id]
        return { id, label: presentation.label, icon: <Icon size={16} />, disabled: !presentation.enabled, divider: dividers.has(id), onClick: () => executeVideoEditCommand(context, id).catch(onError) }
      })
      // Premiere's "Audio Channels" on a sequence clip: reassign the source channels of the clicked clip (task 2.6).
      const clip = clipId ? sequence.clips.find(value => value.id === clipId) : undefined
      if (clip && onNest) items.push({ id: 'nest_sequence', label: '嵌套…', icon: <Group size={16} />, disabled: sequence.clips.some(clip => ids.includes(clip.id) && sequence.tracks.find(track => track.index === clip.track)?.locked), onClick: () => onNest({ projectId: instance.document.id, sequenceId: sequence.id, clipIds: ids }) })
      const multicam = clip && videoEditMulticamSource(instance.document, clip)
      if (clip && multicam?.multicam) {
        const target = { projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }
        for (const [index, camera] of multicam.multicam.cameras.entries()) items.push({ id: `camera_${camera.id}`, label: `机位 ${index + 1} · ${camera.name}`, icon: <Play size={16} />, disabled: sequence.tracks.find(track => track.index === clip.track)?.locked, onClick: () => { try { switchVideoEditMulticam(target, camera.id) } catch (error) { onError(error) } } })
        items.push({ id: 'auto_multicam', label: '建议机位切换', icon: <Play size={16} />, disabled: sequence.tracks.find(track => track.index === clip.track)?.locked, onClick: () => { void autoSwitchVideoEditMulticam(target).catch(onError) } })
      }
      const media = clip && videoEditClipMedia(instance.document, clip)
      if (clip && clip.kind !== 'adjustment' && clip.kind !== 'sequence') items.push({ id: 'send_canvas', label: '发送片段到画布…', icon: <ICON_WORKSPACE_CANVAS size={16} />, onClick: () => setCanvasSend({ projectId: instance.document.id, sequenceId: sequence.id, source: { kind: 'clip', clipId: clip.id } }) })
      if (clip?.kind === 'video' && clip.sourceComponent !== 'audio' && media?.kind === 'video' && onReframe) items.push({ id: 'auto_reframe', label: '自动重构…', icon: <Crop size={16} />, disabled: sequence.tracks.find(track => track.index === clip.track)?.locked, onClick: () => onReframe({ projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }) })
      if (clip?.kind === 'video' && media?.kind === 'video' && onScenes) items.push({ id: 'scene_detection', label: '场景编辑检测…', icon: <Scissors size={16} />, disabled: sequence.tracks.find(track => track.index === clip.track)?.locked, onClick: () => onScenes({ projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }) })
      if (clip && media && onAudioChannels && (clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video' && media.hasAudio === true)) {
        const locked = sequence.tracks.find(track => track.index === clip.track)?.locked === true
        items.push({ id: 'audio_channels', label: '音频声道…', icon: <AudioLines size={16} />, disabled: locked, onClick: () => onAudioChannels({ kind: 'clip', sequenceId: sequence.id, clipIds: [clip.id], mediaId: media.id, ...(clip.audioMapping ? { mapping: clip.audioMapping } : {}) }) })
      }
      // 回到来源继续编辑（4.1）：片段记着来源时打开来源文档并定位，或打开生成记录
      if (inPlace) items.unshift(...inPlace.items({ ...(clipId ? { clipId } : {}), ...(trackId ? { trackId } : {}), frame: inPlace.frameAt(event.clientX) }))
      if (clip?.creativeSource && onOpenSource) items.unshift({ id: 'open_source', label: '回到来源继续编辑', icon: <Undo2 size={16} />, divider: true, onClick: () => onOpenSource(clip.id) })
      menu.showMenu(event, items)
    } catch (error) { onError(error) }
  }
  return { ...menu, show, canvasDialog: canvasSend ? <VideoEditCanvasSendDialog request={canvasSend} onClose={() => setCanvasSend(null)} /> : null }
}
