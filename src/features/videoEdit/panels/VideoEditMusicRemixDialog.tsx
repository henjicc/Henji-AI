import { useEffect, useRef, useState } from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiButton, UiError, UiFormRow, UiGroup, UiModal, UiSegmented } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import type { MusicRemixGranularity } from '@/core/audioAnalysis/music/musicRemixPlan'
import { videoEditFps } from '@/core/videoEdit/time'
import { notificationMessage } from '@/i18n/notifications'
import { remixVideoEditMusic, type VideoEditMusicRemixTarget } from '../application/videoEditMusicRemix'
import { requireVideoEditInstance } from '../application/videoEditService'

export interface VideoEditMusicRemixRequest { projectId: string; sequenceId: string; clipId: string }

const REPETITION_OPTIONS = [{ value: 0, label: '少' }, { value: 0.5, label: '适中' }, { value: 1, label: '多' }] as const
const GRANULARITY_OPTIONS: ReadonlyArray<{ value: MusicRemixGranularity; label: string }> = [{ value: 'beat', label: '拍' }, { value: 'bar', label: '小节' }, { value: 'phrase', label: '乐句' }]

/** PR“重新混合”：输入目标时长（或对齐到序列结尾），自动分析并拼接；结果是可撤销、可逐段微调的子片段。 */
export function VideoEditMusicRemixDialog({ request, onClose }: { request: VideoEditMusicRemixRequest; onClose: () => void }): React.ReactElement {
  const [initial] = useState(() => {
    const document = requireVideoEditInstance(request.projectId).document
    const sequence = document.sequences.find(value => value.id === request.sequenceId)
    const clip = sequence?.clips.find(value => value.id === request.clipId)
    const fps = sequence ? videoEditFps(sequence.frameRate) : 30
    const group = clip?.remix ? sequence!.clips.filter(value => value.remix?.id === clip.remix!.id && value.track === clip.track) : clip ? [clip] : []
    const start = Math.min(...group.map(value => value.start)), end = Math.max(...group.map(value => value.start + value.duration))
    const contentEnd = Math.max(0, ...(sequence?.clips ?? []).filter(value => !group.includes(value)).map(value => value.start + value.duration))
    return { fps, seconds: group.length ? Math.round((end - start) / fps * 10) / 10 : 30, sequenceEndSeconds: contentEnd > start ? (contentEnd - start) / fps : null, repetition: clip?.remix?.repetition ?? 0.5, granularity: clip?.remix?.granularity ?? 'bar' as MusicRemixGranularity, seed: clip?.remix?.seed ?? 0 }
  })
  const [seconds, setSeconds] = useState(initial.seconds)
  const [alignToEnd, setAlignToEnd] = useState(false)
  const [repetition, setRepetition] = useState(REPETITION_OPTIONS.reduce((best, option) => Math.abs(option.value - initial.repetition) < Math.abs(best - initial.repetition) ? option.value : best, 0.5 as number))
  const [granularity, setGranularity] = useState<MusicRemixGranularity>(initial.granularity)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'model' | 'analyze' | null>(null)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const { showNotification } = useNotification()
  useEffect(() => () => operation.current?.abort(), [])
  const run = async (variant: boolean): Promise<void> => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('')
    const target: VideoEditMusicRemixTarget = alignToEnd ? { kind: 'sequence_end' } : { kind: 'frames', frames: Math.max(1, Math.round(seconds * initial.fps)) }
    try {
      const result = await remixVideoEditMusic({ ...request, target, repetition, granularity, seed: variant ? (initial.seed + 1 + Math.floor(Math.random() * 1000)) % 2147483647 : 0 }, controller.signal, event => setPhase(event.phase))
      showNotification(notificationMessage('musicRemixed', { segments: result.clipIds.length, seams: result.seams.length }), 'success'); onClose()
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { operation.current = null; setBusy(false); setPhase(null) }
  }
  return <UiModal isOpen size="compact" title="重构到时长" onClose={() => { if (!busy) onClose() }}
    footer={<>
      <UiButton onClick={() => { operation.current?.abort(); if (!busy) onClose() }}>{busy ? '停止' : '取消'}</UiButton>
      <UiButton disabled={busy} onClick={() => void run(true)} tooltip="同样的参数换一种拼法">换一种</UiButton>
      <UiButton loading={busy} variant="primary" disabled={busy} onClick={() => void run(false)}>{phase === 'model' ? '正在准备节拍模型' : '重构'}</UiButton>
    </>}>
    <UiGroup labelWidth={96}>
      <UiFormRow label="目标时长（秒）" density="compact" trailing={null}>
        <NumberInput ariaLabel="目标时长（秒）" value={alignToEnd && initial.sequenceEndSeconds !== null ? Math.round(initial.sequenceEndSeconds * 10) / 10 : seconds} min={1} max={3600} step={0.1} precision={1} disabled={busy || alignToEnd} onChange={setSeconds} />
      </UiFormRow>
      {initial.sequenceEndSeconds !== null && <UiFormRow label="对齐" density="compact">
        <UiSegmented ariaLabel="目标时长来源" fullWidth disabled={busy} value={alignToEnd ? 'end' : 'manual'} onChange={value => setAlignToEnd(value === 'end')} options={[{ value: 'manual', label: '按时长' }, { value: 'end', label: '序列结尾' }]} />
      </UiFormRow>}
      <UiFormRow label="重复程度" density="compact">
        <UiSegmented ariaLabel="重复程度" fullWidth disabled={busy} value={repetition} onChange={setRepetition} options={REPETITION_OPTIONS} />
      </UiFormRow>
      <UiFormRow label="切分粒度" density="compact">
        <UiSegmented ariaLabel="切分粒度" fullWidth disabled={busy} value={granularity} onChange={setGranularity} options={GRANULARITY_OPTIONS} />
      </UiFormRow>
    </UiGroup>
    {error && <UiError title={error} message="" />}
  </UiModal>
}
