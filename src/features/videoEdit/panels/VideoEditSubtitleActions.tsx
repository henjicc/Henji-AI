import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiFormRow, UiGroup, UiOptionButton, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { styleVideoEditSubtitles, type SubtitleScope } from '../application/videoEditAutoSubtitles'
import { readSubtitleJob, subscribeSubtitleJobs, subtitleJobsRevision, runVideoEditSubtitleJob, cancelSubtitleJob, findRecoverableSubtitleAudio } from '../application/videoEditSubtitleJobs'
import type { VideoEditInstance } from '../application/videoEditService'

export function VideoEditSubtitleActions({ instance, sequence, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeSubtitleJobs, subtitleJobsRevision)
  const [scope, setScope] = useState<SubtitleScope>('sequence'); const [trackId, setTrackId] = useState('')
  const [maxCharacters, setMaxCharacters] = useState(24); const [minDurationSeconds, setMinimum] = useState(1)
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [style, setStyle] = useState<VideoEditSubtitleStyle>(() => sequence.captions?.find(cue => cue.style)?.style || videoEditSubtitleStyleSchema.parse({}))
  const [available, setAvailable] = useState<boolean | null>(null); const [recoverable, setRecoverable] = useState<string>()
  const mounted = useRef(true)
  const errorHandler = useRef(onError); errorHandler.current = onError
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let current = true
    void getPlatform().audioEdit.listAsrModels().then(models => { if (current) setAvailable(models.some(model => model.configured && model.timestamps)) }, error => { if (current) errorHandler.current(error) })
    void findRecoverableSubtitleAudio(instance, sequence.id).then(id => { if (current) setRecoverable(id) }, error => { if (current) errorHandler.current(error) })
    return () => { current = false }
  }, [instance, sequence.id])
  const job = readSubtitleJob(instance, sequence.id)
  const busy = Boolean(job && ['preparing', 'confirming', 'transcribing'].includes(job.state))
  const retry = job?.state !== 'completed' ? job?.audioDocumentId ?? recoverable : undefined
  const run = (resume?: string): void => { void runVideoEditSubtitleJob(instance, sequence.id, scope, trackId || undefined, { maxCharacters, minDurationSeconds, language }, resume).catch(error => { if (mounted.current) onError(error) }) }
  const applyStyle = (): void => { try { styleVideoEditSubtitles(instance.document.id, sequence.id, style) } catch (error) { onError(error) } }
  return <PanelTrigger panelWidth={300} zIndex={Z_LAYERS.dropdown} renderPanel={() => <div className="flex max-h-96 flex-col gap-3 overflow-auto">
    <UiGroup title="自动字幕" titleTone="compact">
      <UiFormRow label="范围" density="compact"><Dropdown ariaLabel="字幕转录范围" size="sm" value={scope} onSelect={setScope} disabled={busy} options={[{ value: 'sequence', label: '整个序列' }, { value: 'in-out', label: '序列入出点' }, { value: 'selection', label: '选中片段' }]} /></UiFormRow>
      <UiFormRow label="声音" density="compact"><Dropdown ariaLabel="字幕声音来源" size="sm" value={trackId} onSelect={setTrackId} disabled={busy} options={[{ value: '', label: '可听混音' }, ...sequence.tracks.map(track => ({ value: track.id, label: track.name }))]} /></UiFormRow>
      <UiFormRow label="语言" density="compact"><Dropdown ariaLabel="字幕识别语言" size="sm" value={language} onSelect={setLanguage} disabled={busy} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: '英语' }]} /></UiFormRow>
      <UiFormRow label="每行最多字数" density="compact"><NumberInput ariaLabel="每行最多字数" size="sm" value={maxCharacters} min={4} max={80} step={1} precision={0} disabled={busy} onChange={setMaxCharacters} /></UiFormRow>
      <UiFormRow label="最短显示（秒）" density="compact"><NumberInput ariaLabel="字幕最短显示秒数" size="sm" value={minDurationSeconds} min={0} max={5} step={.1} precision={1} disabled={busy} onChange={setMinimum} /></UiFormRow>
      <p className={UI_TEXT_META_CLASS}>复用口播识别，按已配置模型计费。句段时间戳只折行；短句只延长到下一句前。选择模型沿用口播的自动选择。</p>
      {available === false && <UiEmpty title="尚未配置时间戳识别模型" description="在设置中配置语音识别供应商后继续。" size="sm" />}
      <div className="flex items-center gap-2"><UiButton size="sm" variant="primary" disabled={busy || !available} onClick={() => run()}>转录并生成字幕</UiButton>{retry && <UiButton size="sm" disabled={busy} onClick={() => run(retry)}>继续上次转录</UiButton>}</div>
      {busy && <div className="flex items-center gap-2"><span className={UI_TEXT_META_CLASS}>{job?.state === 'preparing' ? `准备声音 ${Math.round(job.progress * 100)}%` : job?.state === 'confirming' ? '等待费用确认' : '正在识别声音'}</span><UiButton size="sm" onClick={() => cancelSubtitleJob(instance, sequence.id)}>取消</UiButton></div>}
    </UiGroup>
    <UiGroup title="统一字幕样式" titleTone="compact" divided>
      <UiFormRow label="字体" density="compact"><Dropdown ariaLabel="字幕字体" size="sm" value={style.fontFamily} onSelect={fontFamily => setStyle({ ...style, fontFamily })} options={[{ value: 'sans-serif', label: '无衬线' }, { value: 'serif', label: '衬线' }, { value: 'monospace', label: '等宽' }]} /></UiFormRow>
      <UiFormRow label="字号（1080p）" density="compact"><NumberInput ariaLabel="字幕字号" size="sm" value={style.fontSize} min={12} max={200} step={1} onChange={fontSize => setStyle({ ...style, fontSize })} /></UiFormRow>
      <UiFormRow label="底部安全区（%）" density="compact"><NumberInput ariaLabel="字幕底部安全区百分比" size="sm" value={style.bottomMargin * 100} min={5} max={40} step={1} onChange={value => setStyle({ ...style, bottomMargin: value / 100 })} /></UiFormRow>
      <div className="flex items-center gap-2"><UiOptionButton size="sm" active={style.outline} aria-pressed={style.outline} onClick={() => setStyle({ ...style, outline: !style.outline })}>描边</UiOptionButton><UiOptionButton size="sm" active={style.background} aria-pressed={style.background} onClick={() => setStyle({ ...style, background: !style.background })}>底框</UiOptionButton><UiButton size="sm" disabled={!sequence.captions?.length} onClick={applyStyle}>应用全部</UiButton></div>
    </UiGroup>
  </div>}>
    {({ togglePanel, open }) => <UiButton size="sm" aria-label="自动字幕与样式" aria-haspopup="dialog" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>{busy ? '处理…' : '转录'}</UiButton>}
  </PanelTrigger>
}
