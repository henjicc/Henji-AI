import { useMemo, useState } from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiInput, UiModal } from '@/components/ui'
import { videoEditClipSpeedPercent, videoEditClipSpeedValue, videoEditSpeedRatio, VIDEO_EDIT_SPEED_MAX, VIDEO_EDIT_SPEED_MIN } from '@/core/videoEdit/clipSpeed'
import type { VideoEditSpeedChange } from '@/core/videoEdit/clipSpeedEdits'
import { parseVideoEditTimecodeInput, videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { videoEditFps } from '@/core/videoEdit/time'
import { executeVideoEditTimelineEdit } from '../application/videoEditTimeline'
import { requireVideoEditInstance } from '../application/videoEditService'
import type { VideoEditSpeedDialogRequest } from '../application/videoEditSpeedDialog'

/**
 * PR“剪辑速度/持续时间”（Ctrl+R，4.13）：速度与持续时间互相换算（改一个另一个跟着显示），倒放、保持音调、
 * 波纹编辑后续片段。确定时一步编辑、一步撤销；多选时对每个片段应用同一速度（或同一持续时间）。
 */
export function VideoEditSpeedDialog({ request, onClose }: { request: VideoEditSpeedDialogRequest; onClose: () => void }): React.ReactElement {
  const initial = useMemo(() => {
    const owner = requireVideoEditInstance(request.projectId)
    const sequence = owner.document.sequences.find(value => value.id === request.sequenceId)
    const clips = sequence?.clips.filter(clip => request.clipIds.includes(clip.id)) ?? []
    const first = clips[0]
    return { fps: sequence ? videoEditFps(sequence.frameRate) : 30, percent: first ? videoEditClipSpeedPercent(first) : 100, speed: first ? videoEditClipSpeedValue(first) : 1, duration: first?.duration ?? 1, reverse: clips.length > 0 && clips.every(clip => clip.reverse), preservePitch: clips.length > 0 && clips.every(clip => clip.preservePitch), count: clips.length }
  }, [request])
  const [percent, setPercent] = useState(initial.percent)
  const [duration, setDuration] = useState(initial.duration)
  const [durationText, setDurationText] = useState(videoEditFrameTimecode(initial.duration, initial.fps))
  const [edited, setEdited] = useState<'speed' | 'duration' | null>(null)
  const [reverse, setReverse] = useState(initial.reverse)
  const [preservePitch, setPreservePitch] = useState(initial.preservePitch)
  const [ripple, setRipple] = useState(false)
  const [error, setError] = useState('')
  const changeSpeed = (value: number): void => {
    const next = Math.max(VIDEO_EDIT_SPEED_MIN * 100, Math.min(VIDEO_EDIT_SPEED_MAX * 100, value))
    const frames = Math.max(1, Math.round(initial.duration * initial.speed / (next / 100)))
    setPercent(next); setDuration(frames); setDurationText(videoEditFrameTimecode(frames, initial.fps)); setEdited('speed')
  }
  const commitDuration = (): void => {
    const frames = parseVideoEditTimecodeInput(durationText, initial.fps, duration)
    if (frames === null || frames < 1) { setDurationText(videoEditFrameTimecode(duration, initial.fps)); return }
    const next = Math.max(VIDEO_EDIT_SPEED_MIN * 100, Math.min(VIDEO_EDIT_SPEED_MAX * 100, Math.round(initial.speed * initial.duration / frames * 10_000) / 100))
    setDuration(frames); setDurationText(videoEditFrameTimecode(frames, initial.fps)); setPercent(next); setEdited('duration')
  }
  const submit = (): void => {
    try {
      const change: VideoEditSpeedChange = {
        ...(edited === 'speed' ? { speed: videoEditSpeedRatio(percent / 100) } : edited === 'duration' ? { duration } : {}),
        ...(reverse !== initial.reverse ? { reverse } : {}), ...(preservePitch !== initial.preservePitch ? { preservePitch } : {}), ripple,
      }
      if (change.speed || change.duration !== undefined || change.reverse !== undefined || change.preservePitch !== undefined) executeVideoEditTimelineEdit(request.projectId, request.sequenceId, { kind: 'speed', clipIds: request.clipIds, linked: false, change })
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <UiModal isOpen title="剪辑速度/持续时间" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={!initial.count} onClick={submit}>确定</UiButton></>}>
    <div className="space-y-4" data-video-edit-speed-dialog="">
      <UiGroup>
        <UiFormRow label="速度" inline>
          <div className="flex items-center gap-2">
            <NumberInput ariaLabel="速度百分比" value={percent} min={VIDEO_EDIT_SPEED_MIN * 100} max={VIDEO_EDIT_SPEED_MAX * 100} step={1} precision={2} widthClassName="w-28" onChange={changeSpeed} />
            <span>%</span>
          </div>
        </UiFormRow>
        <UiFormRow label="持续时间" inline>
          <UiInput aria-label="持续时间" className="w-28" value={durationText} onChange={event => setDurationText(event.target.value)} onBlur={commitDuration} onKeyDown={event => { if (event.key === 'Enter') commitDuration() }} />
        </UiFormRow>
        <UiFormRow label="倒放速度" inline><UiCheckbox checked={reverse} onCheckedChange={setReverse} /></UiFormRow>
        <UiFormRow label="保持音频音调" inline><UiCheckbox checked={preservePitch} onCheckedChange={setPreservePitch} /></UiFormRow>
        <UiFormRow label="波纹编辑，移动尾部剪辑" inline><UiCheckbox checked={ripple} onCheckedChange={setRipple} /></UiFormRow>
      </UiGroup>
      {error && <UiError message={error} />}
    </div>
  </UiModal>
}
