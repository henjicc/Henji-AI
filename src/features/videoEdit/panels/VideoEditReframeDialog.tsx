import { useEffect, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Dropdown, UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiInput, UiLoading, UiModal, UiTooltipText } from '@/components/ui'
import { VIDEO_EDIT_REFRAME_SIZES, type VideoEditReframeSettings } from '@/core/videoEdit/reframe'
import { reframeVideoEdit, type VideoEditReframeResult, type VideoEditReframeTarget } from '../application/videoEditReframe'
import { requireVideoEditInstance, saveVideoEdit, switchVideoEditSequence } from '../application/videoEditService'
import { queueVideoEditReframe, videoEditReframeMessage } from '../application/videoEditReframeCapability'
import { videoEditExportPresetLibrary } from '../application/videoEditExportPresets'

export function VideoEditReframeDialog({ target, onClose }: { target: VideoEditReframeTarget; onClose: () => void }): React.ReactElement {
  const [ratio, setRatio] = useState('9:16'); const [size, setSize] = useState<{ width: number; height: number }>({ ...VIDEO_EDIT_REFRAME_SIZES['9:16'] })
  const [name, setName] = useState(''); const [settings, setSettings] = useState<VideoEditReframeSettings>({ motion: 'default', attention: 'auto' })
  const sequence = requireVideoEditInstance(target.projectId).document.sequences.find(sequence => sequence.id === target.sequenceId)
  const clips = sequence?.clips.filter(clip => clip.kind === 'video' && clip.sourceComponent !== 'audio' && (!target.clipId || clip.id === target.clipId)) ?? []
  const [trackers, setTrackers] = useState<Record<string, string>>({})
  const [exportPreset, setExportPreset] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState('')
  const [result, setResult] = useState<VideoEditReframeResult | null>(null); const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const close = (): void => { controller.current?.abort(); onClose() }
  const run = async (): Promise<void> => {
    const current = new AbortController(); controller.current = current; setBusy(true); setError('')
    try {
      const generated = result ?? await reframeVideoEdit(target, { size, name, settings, trackers }, current.signal, setProgress)
      setResult(generated)
      setMessage(videoEditReframeMessage(generated))
      // After an in-memory success, retries only save/export; never generate another copy.
      await saveVideoEdit(target.projectId)
      if (exportPreset) {
        const queued = await queueVideoEditReframe(target.projectId, generated.sequenceId, exportPreset, current.signal)
        setMessage(videoEditReframeMessage(generated) + (queued.exportIssue ?? '已加入导出队列，可在导出列表查看进度。'))
      }
      if (!current.signal.aborted && generated.created) switchVideoEditSequence(target.projectId, generated.sequenceId)
    } catch (reason) { if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (controller.current === current) { controller.current = null; setBusy(false) } }
  }
  const outputSize = target.clipId && sequence ? sequence : size
  const presets = videoEditExportPresetLibrary.list().filter(preset => preset.settings.format === 'mp4' && (preset.settings.keepSequenceSize || preset.settings.width * outputSize.height === preset.settings.height * outputSize.width))
  return <UiModal isOpen title={target.clipId ? '自动重构片段' : '自动重构序列'} onClose={close} footer={<>
    <UiButton onClick={close}>{busy ? '取消操作' : result ? '完成' : '取消'}</UiButton>
    {!result && <UiButton variant="primary" disabled={busy || !clips.length} onClick={() => { void run() }}>{target.clipId ? '生成构图' : '创建并重构'}</UiButton>}
  </>}>
    <div className="space-y-4">
      {!result && <UiGroup>
        {!target.clipId && <>
          <UiFormRow label="新序列名称"><UiInput aria-label="新序列名称" value={name} disabled={busy} placeholder="按原序列自动命名" maxLength={200} onChange={event => setName(event.target.value)} /></UiFormRow>
          <UiFormRow label="目标画幅"><Dropdown value={ratio} disabled={busy} options={[...Object.keys(VIDEO_EDIT_REFRAME_SIZES).map(value => ({ value, label: value })), { value: 'custom', label: '自定义' }]} onSelect={value => { setRatio(value); setExportPreset(''); if (value in VIDEO_EDIT_REFRAME_SIZES) setSize(VIDEO_EDIT_REFRAME_SIZES[value as keyof typeof VIDEO_EDIT_REFRAME_SIZES]) }} /></UiFormRow>
          {ratio === 'custom' && <div className="grid grid-cols-2 gap-3">{(['width', 'height'] as const).map((key, i) => <UiFormRow key={key} label={i ? '高度' : '宽度'}><UiInput aria-label={i ? '高度' : '宽度'} type="number" value={size[key]} min={16} max={4096} disabled={busy} onChange={event => { setSize(value => ({ ...value, [key]: Number(event.target.value) })); setExportPreset('') }} /></UiFormRow>)}</div>}
        </>}
        <UiFormRow label="运动速度"><Dropdown value={settings.motion} disabled={busy} options={[{ value: 'slow', label: '慢' }, { value: 'default', label: '默认' }, { value: 'fast', label: '快' }]} onSelect={motion => setSettings(value => ({ ...value, motion: motion as VideoEditReframeSettings['motion'] }))} /></UiFormRow>
        <UiFormRow label={<UiTooltipText tooltip="自动优先人物；人物放不下时按最大人脸构图。未检出主体的画面保持构图，完成后请检查。">关注主体</UiTooltipText>}><Dropdown value={settings.attention} disabled={busy} options={[{ value: 'auto', label: '自动（人物 / 人脸）' }, { value: 'person', label: '人物' }, { value: 'face', label: '最大人脸' }, { value: 'tracker', label: '跟随指定跟踪器' }]} onSelect={attention => setSettings(value => ({ ...value, attention: attention as VideoEditReframeSettings['attention'] }))} /></UiFormRow>
        {settings.attention === 'tracker' && <Virtuoso className="h-64" data={clips} itemContent={(_index, clip) => <UiFormRow label={clip.name}><Dropdown value={trackers[clip.id] ?? ''} disabled={busy} options={[{ value: '', label: '选择已完成的跟踪器' }, ...(clip.trackers ?? []).filter(tracker => ['shape', 'box'].includes(tracker.method)).map(tracker => ({ value: tracker.id, label: tracker.name }))]} onSelect={value => setTrackers(previous => ({ ...previous, [clip.id]: value }))} /></UiFormRow>} />}
        <UiFormRow label="完成后加入导出队列" inline><UiCheckbox checked={!!exportPreset} disabled={busy || !presets.length} onCheckedChange={checked => setExportPreset(checked ? presets[0].id : '')} /></UiFormRow>
        {!!exportPreset && <UiFormRow label="导出预设"><Dropdown value={exportPreset} disabled={busy} options={presets.map(preset => ({ value: preset.id, label: preset.name }))} onSelect={setExportPreset} /></UiFormRow>}
      </UiGroup>}
      {busy && <UiLoading message={result ? '正在保存构图' : `正在分析并生成构图 ${Math.round(progress * 100)}%`} />}
      {result && <p className="text-sm text-text2">{message}</p>}
      {error && <UiError message={error} onRetry={() => { void run() }} retryLabel={result ? '重试保存' : '重新生成'} />}
    </div>
  </UiModal>
}
