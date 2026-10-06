import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Dropdown, PanelTrigger, UiButton, UiCheckbox, UiEmpty, UiError, UiFormRow, UiGroup, UiInput, UiLoading, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { styleVideoEditSubtitles, segmentVideoEditSubtitles, type SubtitleScope } from '../application/videoEditAutoSubtitles'
import { readSubtitleJob, subscribeSubtitleJobs, subtitleJobsRevision, runVideoEditSubtitleJob, cancelSubtitleJob, findRecoverableSubtitleAudio } from '../application/videoEditSubtitleJobs'
import type { VideoEditInstance } from '../application/videoEditService'
import { listVideoEditSubtitlePresets, useVideoEditSubtitleLibraryStore } from '../application/videoEditSubtitlePresets'
import { confirmVideoEditBilingualSubtitles, type SubtitleTranslationLanguage } from '../application/videoEditBilingualSubtitles'

export function VideoEditSubtitleActions({ instance, sequence, selectedCaptionId, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; selectedCaptionId?: string; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeSubtitleJobs, subtitleJobsRevision)
  const [scope, setScope] = useState<SubtitleScope>('sequence'); const [trackId, setTrackId] = useState('')
  const [maxCharacters, setMaxCharacters] = useState(24); const [minDurationSeconds, setMinimum] = useState(1)
  const [maxLines, setMaxLines] = useState(2); const [pauseSeconds, setPauseSeconds] = useState(.6)
  const [presetId, setPresetId] = useState(''); const [presetName, setPresetName] = useState('')
  const [targetLanguage, setTargetLanguage] = useState<SubtitleTranslationLanguage>('en')
  const [translating, setTranslating] = useState(false)
  const translation = useRef<AbortController>()
  const library = useVideoEditSubtitleLibraryStore()
  const presets = listVideoEditSubtitlePresets()
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [style, setStyle] = useState<VideoEditSubtitleStyle>(() => sequence.captions?.find(cue => cue.style)?.style || videoEditSubtitleStyleSchema.parse({}))
  const [available, setAvailable] = useState<boolean | null>(null); const [recoverable, setRecoverable] = useState<string>()
  const mounted = useRef(true)
  const errorHandler = useRef(onError); errorHandler.current = onError
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; translation.current?.abort(new Error('字幕面板已关闭。')) } }, [])
  useEffect(() => {
    let current = true
    void getPlatform().audioEdit.listAsrModels().then(models => { if (current) setAvailable(models.some(model => model.configured && model.timestamps)) }, error => { if (current) errorHandler.current(error) })
    void findRecoverableSubtitleAudio(instance, sequence.id).then(id => { if (current) setRecoverable(id) }, error => { if (current) errorHandler.current(error) })
    return () => { current = false }
  }, [instance, sequence.id])
  const job = readSubtitleJob(instance, sequence.id)
  const transcribing = Boolean(job && ['preparing', 'confirming', 'transcribing'].includes(job.state))
  const busy = transcribing || translating
  const retry = job?.state !== 'completed' ? job?.audioDocumentId ?? recoverable : undefined
  const run = (resume?: string): void => { void runVideoEditSubtitleJob(instance, sequence.id, scope, trackId || undefined, { maxCharacters, maxLines, pauseSeconds, minDurationSeconds, language }, resume).catch(error => { if (mounted.current) onError(error) }) }
  const applyStyle = (selected = false): void => { try { styleVideoEditSubtitles(instance.document.id, sequence.id, style, selected && selectedCaptionId ? [selectedCaptionId] : undefined) } catch (error) { onError(error) } }
  const changeStyle = (value: VideoEditSubtitleStyle): void => { setPresetId(''); setStyle(value) }
  const translate = (): void => {
    const controller = new AbortController(); translation.current = controller; setTranslating(true)
    void confirmVideoEditBilingualSubtitles(instance.document.id, sequence.id, { targetLanguage }, controller.signal).catch(error => { if (mounted.current && !controller.signal.aborted) onError(error) }).finally(() => { if (mounted.current) setTranslating(false); if (translation.current === controller) translation.current = undefined })
  }
  return <PanelTrigger panelWidth={300} zIndex={Z_LAYERS.dropdown} renderPanel={() => <div className="flex max-h-96 flex-col gap-3 overflow-auto">
    <UiGroup title="自动字幕" titleTone="compact">
      <UiFormRow label="范围" density="compact"><Dropdown ariaLabel="字幕转录范围" size="sm" value={scope} onSelect={setScope} disabled={busy} options={[{ value: 'sequence', label: '整个序列' }, { value: 'in-out', label: '序列入出点' }, { value: 'selection', label: '选中片段' }]} /></UiFormRow>
      <UiFormRow label="声音" density="compact"><Dropdown ariaLabel="字幕声音来源" size="sm" value={trackId} onSelect={setTrackId} disabled={busy} options={[{ value: '', label: '可听混音' }, ...sequence.tracks.map(track => ({ value: track.id, label: track.name }))]} /></UiFormRow>
      <UiFormRow label="语言" density="compact"><Dropdown ariaLabel="字幕识别语言" size="sm" value={language} onSelect={setLanguage} disabled={busy} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: '英语' }]} /></UiFormRow>
      <UiFormRow label="每行最多字数" info="长句会自动拆分；部分识别结果的拆分时刻为估算值，生成后可校正。" density="compact"><NumberInput ariaLabel="每行最多字数" size="sm" value={maxCharacters} min={4} max={80} step={1} precision={0} disabled={busy} onChange={setMaxCharacters} /></UiFormRow>
      <UiFormRow label="每条最多行数" density="compact"><NumberInput ariaLabel="每条字幕最多行数" size="sm" value={maxLines} min={1} max={3} step={1} precision={0} disabled={busy} onChange={setMaxLines} /></UiFormRow>
      <UiFormRow label="停顿断句（秒）" density="compact"><NumberInput ariaLabel="字幕停顿断句秒数" size="sm" value={pauseSeconds} min={.1} max={2} step={.1} precision={1} disabled={busy} onChange={setPauseSeconds} /></UiFormRow>
      <UiFormRow label="最短显示（秒）" density="compact"><NumberInput ariaLabel="字幕最短显示秒数" size="sm" value={minDurationSeconds} min={0} max={5} step={.1} precision={1} disabled={busy} onChange={setMinimum} /></UiFormRow>
      <p className={UI_TEXT_META_CLASS}>语音识别按所选模型计费。</p>
      {available === false && <UiEmpty title="尚未配置时间戳识别模型" description="在设置中配置语音识别供应商后继续。" size="sm" />}
      <div className="flex flex-wrap items-center gap-2"><UiButton size="sm" variant="primary" disabled={busy || !available} onClick={() => run()}>转录并生成字幕</UiButton>{retry && <UiButton size="sm" disabled={busy} onClick={() => run(retry)}>继续上次转录</UiButton>}</div>
      <UiButton size="sm" disabled={busy || !sequence.captions?.length} onClick={() => { try { segmentVideoEditSubtitles(instance.document.id, sequence.id, { maxCharacters, maxLines, pauseSeconds }) } catch (error) { onError(error) } }}>整理已有长句</UiButton>
      {transcribing && <UiLoading size="xs" message={job?.state === 'preparing' ? `准备声音 ${Math.round(job.progress * 100)}%` : job?.state === 'confirming' ? '等待费用确认' : '正在识别声音'}><UiButton size="sm" onClick={() => cancelSubtitleJob(instance, sequence.id)}>取消</UiButton></UiLoading>}
    </UiGroup>
    <UiGroup title="统一字幕样式" titleTone="compact" divided>
      <UiFormRow label="样式预设" density="compact"><Dropdown ariaLabel="字幕样式预设" size="sm" value={presetId} options={[{ value: '', label: '自定义样式' }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))]} onSelect={id => { setPresetId(id); const preset = presets.find(preset => preset.id === id); if (preset) setStyle(preset.style) }} /></UiFormRow>
      <UiFormRow label="字体" density="compact"><Dropdown ariaLabel="字幕字体" size="sm" value={style.fontFamily} onSelect={fontFamily => changeStyle({ ...style, fontFamily })} options={[{ value: 'sans-serif', label: '无衬线' }, { value: 'serif', label: '衬线' }, { value: 'monospace', label: '等宽' }]} /></UiFormRow>
      <UiFormRow label="字号（1080p）" density="compact"><NumberInput ariaLabel="字幕字号" size="sm" value={style.fontSize} min={12} max={200} step={1} onChange={fontSize => changeStyle({ ...style, fontSize })} /></UiFormRow>
      <UiFormRow label="底部安全区（%）" density="compact"><NumberInput ariaLabel="字幕底部安全区百分比" size="sm" value={style.bottomMargin * 100} min={5} max={40} step={1} onChange={value => changeStyle({ ...style, bottomMargin: value / 100 })} /></UiFormRow>
      <UiFormRow label="描边" inline density="compact"><UiCheckbox checked={style.outline} onCheckedChange={outline => changeStyle({ ...style, outline })} /></UiFormRow>
      <UiFormRow label="底框" inline density="compact"><UiCheckbox checked={style.background} onCheckedChange={background => changeStyle({ ...style, background })} /></UiFormRow>
      <div className="flex flex-wrap items-center gap-2"><UiButton size="sm" disabled={busy || !sequence.captions?.length} onClick={() => applyStyle()}>应用全部</UiButton><UiButton size="sm" disabled={busy || !selectedCaptionId} onClick={() => applyStyle(true)}>应用选中</UiButton></div>
      <UiFormRow label="保存为预设" density="compact"><UiInput size="sm" aria-label="字幕预设名称" value={presetName} maxLength={200} onChange={event => setPresetName(event.target.value)} /></UiFormRow>
      <div className="flex flex-wrap items-center gap-2"><UiButton size="sm" disabled={!presetName.trim() || Boolean(library.loadError)} onClick={() => { try { const preset = library.savePreset(presetName, style); setPresetId(preset.id); setPresetName('') } catch (error) { onError(error) } }}>保存预设</UiButton><UiButton variant="danger" size="sm" disabled={!library.presets.some(preset => preset.id === presetId)} onClick={() => { try { library.deletePreset(presetId); setPresetId('') } catch (error) { onError(error) } }}>删除预设</UiButton></div>
      {library.loadError && <UiError size="xs" message={library.loadError} />}
    </UiGroup>
    <UiGroup title="双语字幕" titleTone="compact" divided>
      <UiFormRow label="第二语言" density="compact"><Dropdown ariaLabel="字幕第二语言" size="sm" value={targetLanguage} onSelect={setTargetLanguage} disabled={busy} options={[{ value: 'en', label: '英语' }, { value: 'zh', label: '中文' }, { value: 'ja', label: '日语' }, { value: 'ko', label: '韩语' }, { value: 'fr', label: '法语' }, { value: 'es', label: '西班牙语' }, { value: 'de', label: '德语' }]} /></UiFormRow>
      <UiButton size="sm" disabled={busy || !sequence.captions?.length} onClick={translate}>{translating ? '正在翻译…' : '生成第二语言'}</UiButton>
      {translating && <UiLoading size="xs" message="正在翻译字幕…" />}
      {translating && <UiButton size="sm" onClick={() => translation.current?.abort(new Error('双语字幕已取消。'))}>取消翻译</UiButton>}
    </UiGroup>
  </div>}>
    {({ togglePanel, open }) => <UiButton size="sm" aria-label="自动字幕与样式" aria-haspopup="dialog" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>{busy ? '处理…' : '转录'}</UiButton>}
  </PanelTrigger>
}
