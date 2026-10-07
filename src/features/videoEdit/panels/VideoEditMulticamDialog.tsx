import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from '@/core/videoEdit/time'
import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiError, UiFormRow, UiInput, UiModal } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { createVideoEditMulticamSource } from '../application/videoEditMulticam'
import { requireVideoEditInstance } from '../application/videoEditService'
import type { VideoEditMulticamCreate } from '@/core/videoEdit/multicam'

export function VideoEditMulticamDialog({ projectId, sequenceId, itemIds, onClose }: { projectId: string; sequenceId: string; itemIds: string[]; onClose: () => void }): React.ReactElement {
  const [name, setName] = useState('多机位源序列'); const [sync, setSync] = useState<VideoEditMulticamCreate['sync']>('audio')
  const [audioCameraIndex, setAudio] = useState(0); const [speakers, setSpeakers] = useState<string[]>(itemIds.map(() => ''))
  const [points, setPoints] = useState<number[]>(() => itemIds.map(id => (requireVideoEditInstance(projectId).document.items.find(item => item.id === id)?.sourceRange?.inUs ?? 0) / 1e6))
  const [timecodes, setTimecodes] = useState<number[]>(itemIds.map(() => 0))
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const owner = requireVideoEditInstance(projectId)
  const cameras = itemIds.map((id, index) => ({ value: index, label: `${index + 1} · ${owner.document.items.find(item => item.id === id)?.name ?? '视频'}` }))
  const cancel = (): void => { abort.current?.abort(); onClose() }
  const submit = async (): Promise<void> => {
    if (busy) return
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError('')
    try {
      await createVideoEditMulticamSource(projectId, sequenceId, { name, sync, audioCameraIndex, cameras: itemIds.map((itemId, index) => ({ itemId, speaker: speakers[index], inPointSeconds: points[index], timecodeSeconds: timecodes[index] })) }, controller.signal)
      if (!controller.signal.aborted) onClose()
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <UiModal isOpen title="创建多机位源序列" onClose={cancel} footer={<><UiButton onClick={cancel}>取消</UiButton><UiButton variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>{busy ? '正在同步…' : '创建'}</UiButton></>}>
    <div className="flex flex-col gap-3">
      <UiFormRow label="序列名称"><UiInput aria-label="多机位序列名称" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} /></UiFormRow>
      <UiFormRow label="同步方式"><Dropdown value={sync} disabled={busy} options={[{ value: 'audio', label: '声音自动同步' }, { value: 'in_points', label: '入点' }, { value: 'timecode', label: '时间码' }]} onSelect={setSync} /></UiFormRow>
      <UiFormRow label="主音频"><Dropdown value={audioCameraIndex} disabled={busy} options={cameras} onSelect={setAudio} /></UiFormRow>
      {cameras.map((camera, index) => <div key={itemIds[index]} className="flex flex-col gap-2">
        <UiFormRow label={camera.label}><UiInput aria-label={`机位${index + 1}说话人`} placeholder="说话人（可选）" maxLength={200} disabled={busy} value={speakers[index]} onChange={event => setSpeakers(values => values.map((value, i) => i === index ? event.target.value : value))} /></UiFormRow>
        {sync !== 'audio' && <UiFormRow label={sync === 'in_points' ? '同步入点（秒）' : '素材开始时间码（秒）'}><NumberInput ariaLabel={`机位${index + 1}同步时间`} min={0} max={VIDEO_EDIT_MAX_SEQUENCE_SECONDS} step={.001} precision={3} value={sync === 'in_points' ? points[index] : timecodes[index]} disabled={busy} onChange={next => (sync === 'in_points' ? setPoints : setTimecodes)(values => values.map((value, i) => i === index ? next : value))} /></UiFormRow>}
      </div>)}
      {error && <UiError message={error} />}
    </div>
  </UiModal>
}
