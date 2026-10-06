import { useCallback, useState } from 'react'
import { ArrowRightFromLine, Replace, Undo2 } from 'lucide-react'
import type { MenuItem } from '@/hooks/useContextMenu'
import { ICON_NODE_AUDIO_GENERATION, ICON_NODE_VIDEO_GENERATION } from '@/core/theme/icons'
import { videoEditTrackGap, type VideoEditInPlaceIntent } from '@/core/videoEdit/inPlaceGeneration'
import { videoEditFps } from '@/core/videoEdit/time'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditInstance } from '../application/videoEditService'
import { switchVideoEditClipTakeInProject, type VideoEditInPlaceJob } from '../application/videoEditInPlaceGeneration'
import { VideoEditInPlaceDialog, type VideoEditInPlaceDialogInitial } from '../panels/VideoEditInPlaceDialog'

/** 右键落点：点在哪条轨道的哪一帧、点没点在片段上。 */
export interface VideoEditInPlaceMenuTarget { clipId?: string; trackId?: string; frame: number | null }
export interface VideoEditInPlaceMenu {
  items(target: VideoEditInPlaceMenuTarget): MenuItem[]
  /** 失败的占位“换模型”：用原来的设置重新打开面板。 */
  reopen(job: VideoEditInPlaceJob): void
  dialog: React.ReactElement | null
}
interface Open { intent: VideoEditInPlaceIntent; initial?: VideoEditInPlaceDialogInitial; replacesJobId?: string }
/** 后面没有片段时，点得离前一片段不远就接着它放，远了就放在点的位置。 */
const OPEN_GAP_SNAP_SECONDS = 10
const ICON_SIZE = 16

/**
 * 时间线右键里的原地生成（4.12）：空白处或入出点区间“生成镜头 / 配音配乐”，选中画面片段“替换镜头 / 延长”，
 * 声音片段“重新配音配乐”，被替换过的片段“切回原镜头”。弹出紧凑的生成面板，提交后时间线上出现占位。
 */
export function useVideoEditInPlaceMenu(instance: VideoEditInstance, sequence: VideoEditSequence, onError: (error: unknown) => void): VideoEditInPlaceMenu {
  const [open, setOpen] = useState<Open | null>(null)
  const projectId = instance.document.id
  const items = (target: VideoEditInPlaceMenuTarget): MenuItem[] => {
    const fps = videoEditFps(sequence.frameRate)
    const clip = target.clipId ? sequence.clips.find(value => value.id === target.clipId) : undefined
    const track = clip ? sequence.tracks.find(value => value.index === clip.track) : sequence.tracks.find(value => value.id === target.trackId)
    const locked = track?.locked === true
    const show = (intent: VideoEditInPlaceIntent): void => setOpen({ intent })
    const result: MenuItem[] = []
    if (clip) {
      if (clip.kind === 'video' || clip.kind === 'image') {
        result.push({ id: 'in_place_replace', label: '替换镜头…', icon: <Replace size={ICON_SIZE} />, disabled: locked, onClick: () => show({ action: 'replace_shot', clipId: clip.id }) })
        result.push({ id: 'in_place_extend', label: '延长…', icon: <ArrowRightFromLine size={ICON_SIZE} />, disabled: locked, onClick: () => show({ action: 'extend_shot', clipId: clip.id }) })
      } else if (clip.kind === 'audio') {
        const Icon = ICON_NODE_AUDIO_GENERATION
        result.push({ id: 'in_place_audio_replace', label: '重新配音 / 配乐…', icon: <Icon size={ICON_SIZE} />, disabled: locked, onClick: () => show({ action: 'generate_audio', clipId: clip.id }) })
      }
      clip.takes?.slice(0, 3).forEach((take, index) => result.push({ id: `in_place_take_${index}`, label: `切回「${take.name}」`, icon: <Undo2 size={ICON_SIZE} />, disabled: locked,
        onClick: () => { try { switchVideoEditClipTakeInProject(projectId, sequence.id, clip.id, index) } catch (error) { onError(error) } } }))
    } else if (track && target.frame !== null) {
      const kind = track.kind
      const Icon = kind === 'audio' ? ICON_NODE_AUDIO_GENERATION : ICON_NODE_VIDEO_GENERATION
      const action = kind === 'audio' ? 'generate_audio' : 'generate_shot'
      const label = kind === 'audio' ? '配音 / 配乐' : '生成镜头'
      const { inFrame, outFrame } = instance
      // 点在入出点区间里：按区间生成，长度等于区间
      if (inFrame !== null && outFrame !== null && target.frame >= inFrame && target.frame < outFrame) {
        const free = !sequence.clips.some(value => value.track === track.index && value.start < outFrame && value.start + value.duration > inFrame)
        result.push({ id: 'in_place_range', label: `在入出点之间${label}…`, icon: <Icon size={ICON_SIZE} />, disabled: locked, onClick: () => show({ action, frame: inFrame, duration: outFrame - inFrame, ...(free ? { trackIndex: track.index } : {}) }) })
      }
      const gap = videoEditTrackGap(sequence, track.index, target.frame)
      if (gap) {
        const frame = gap.to === null && target.frame - gap.from > OPEN_GAP_SNAP_SECONDS * fps ? target.frame : gap.from
        result.push({ id: 'in_place_generate', label: `${label}…`, icon: <Icon size={ICON_SIZE} />, disabled: locked, onClick: () => show({ action, frame, trackIndex: track.index }) })
      }
    }
    // 排在菜单最前，与后面的剪辑命令之间一条分隔线
    if (result.length) result[result.length - 1] = { ...result[result.length - 1], divider: true }
    return result
  }
  const reopen = useCallback((job: VideoEditInPlaceJob): void => {
    setOpen({ intent: job.request.intent, initial: { prompt: job.request.prompt, modelId: job.modelId, params: job.request.params, referenceRoles: job.request.referenceRoles }, replacesJobId: job.id })
  }, [])
  const dialog = open ? <VideoEditInPlaceDialog projectId={projectId} sequenceId={sequence.id} intent={open.intent} initial={open.initial} replacesJobId={open.replacesJobId} onClose={() => setOpen(null)} /> : null
  return { items, reopen, dialog }
}
