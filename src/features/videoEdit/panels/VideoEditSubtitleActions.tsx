import { useVideoEditTypographyGesture } from './useVideoEditTypographyGesture'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiLoading, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { scaleVideoEditTextStyle } from '@/core/videoEdit/text'
import { videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { styleVideoEditSubtitles, segmentVideoEditSubtitles, type SubtitleScope } from '../application/videoEditAutoSubtitles'
import { readSubtitleJob, subscribeSubtitleJobs, subtitleJobsRevision, runVideoEditSubtitleJob, cancelSubtitleJob, findRecoverableSubtitleAudio } from '../application/videoEditSubtitleJobs'
import { subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { listVideoEditSubtitlePresets } from '../application/videoEditSubtitlePresets'
import { confirmVideoEditBilingualSubtitles, type SubtitleTranslationLanguage } from '../application/videoEditBilingualSubtitles'
import { useVideoEditFontPreview } from './useVideoEditFontPreview'
import { collectVideoEditFonts } from '@/core/videoEdit/fonts'
import { SUBTITLE_STYLE_PROFILES } from '@/core/videoEdit/subtitleStyleProfiles'

const netflix = SUBTITLE_STYLE_PROFILES.netflix_zh_hans

export function VideoEditSubtitleActions({ instance, sequence, selectedCaptionId, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; selectedCaptionId?: string; onError: (error: unknown) => void }): React.ReactElement {
  const { t } = useTranslation('common')
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  sequence = instance.document.sequences.find(value => value.id === sequence.id) ?? sequence
  useSyncExternalStore(subscribeSubtitleJobs, subtitleJobsRevision)
  const [scope, setScope] = useState<SubtitleScope>('sequence'); const [trackId, setTrackId] = useState('')
  const [maxCharacters, setMaxCharacters] = useState(netflix.maxCharacters); const [minDurationSeconds, setMinimum] = useState(netflix.minDurationSeconds)
  const [maxLines, setMaxLines] = useState(netflix.maxLines); const [pauseSeconds, setPauseSeconds] = useState(.25)
  const [subtitleProfile, setSubtitleProfile] = useState<'netflix_zh_hans' | 'custom'>('netflix_zh_hans')
  const subtitleOptions = subtitleProfile === 'netflix_zh_hans' ? { style: subtitleProfile } : { style: subtitleProfile, maxCharacters, maxLines, pauseSeconds, minDurationSeconds }
  const [presetId, setPresetId] = useState('')
  const [targetLanguage, setTargetLanguage] = useState<SubtitleTranslationLanguage>('en')
  const [translating, setTranslating] = useState(false)
  const [normalizing, setNormalizing] = useState(false)
  const normalization = useRef<AbortController>()
  const translation = useRef<AbortController>()
  const presets = listVideoEditSubtitlePresets()
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const currentCaption = selectedCaptionId ? sequence.captions?.find(cue => cue.id === selectedCaptionId) : sequence.captions?.[0]
  const [style, setStyle] = useState<VideoEditSubtitleStyle>(() => currentCaption?.style || videoEditSubtitleStyleSchema.parse({}))
  useEffect(() => { setStyle(currentCaption?.style || videoEditSubtitleStyleSchema.parse({})) }, [currentCaption?.id, currentCaption?.style, selectedCaptionId, sequence.id])
  const { bottomMargin: _bottomMargin, ...typography } = style
  const typographyGesture = useVideoEditTypographyGesture(instance.document.id, `${sequence.id}:subtitle:${selectedCaptionId ?? ''}`, onError)
  const typographyBaseline = useRef<VideoEditSubtitleStyle>()
  const beginTypography = (): void => { typographyBaseline.current ??= style; if (sequence.captions?.length) typographyGesture.begin() }
  const endTypography = (commit: boolean): void => { typographyGesture.end(commit); const baseline = typographyBaseline.current; typographyBaseline.current = undefined; if (!commit && baseline) setStyle(baseline) }
  const previewFont = useVideoEditFontPreview(instance.document.id, `${sequence.id}:subtitle:${selectedCaptionId ?? ''}`, onError, (fontFamily, gesture) => styleVideoEditSubtitles(instance.document.id, sequence.id, { ...style, fontFamily }, selectedCaptionId ? [selectedCaptionId] : undefined, gesture))
  const [open, setOpen] = useState(false)
  const [modelAttempt, setModelAttempt] = useState(0)
  const [models, setModels] = useState<'loading' | 'failed' | 'unconfigured' | 'configured'>('loading'); const [recoverable, setRecoverable] = useState<string>()
  const mounted = useRef(true)
  const errorHandler = useRef(onError); errorHandler.current = onError
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; translation.current?.abort(new Error('字幕面板已关闭。')); normalization.current?.abort(new Error('字幕面板已关闭。')) } }, [])
  useEffect(() => {
    if (!open) return
    let current = true
    setModels('loading')
    void getPlatform().audioEdit.listAsrModels().then(models => { if (current) setModels(models.some(model => model.configured && model.timestamps) ? 'configured' : 'unconfigured') }, error => { if (current) { setModels('failed'); errorHandler.current(error) } })
    return () => { current = false }
  }, [open, instance, sequence.id, modelAttempt])
  useEffect(() => {
    let current = true
    void findRecoverableSubtitleAudio(instance, sequence.id).then(id => { if (current) setRecoverable(id) }, error => { if (current) errorHandler.current(error) })
    return () => { current = false }
  }, [instance, sequence.id])
  const job = readSubtitleJob(instance, sequence.id)
  const transcribing = Boolean(job && ['preparing', 'confirming', 'transcribing'].includes(job.state))
  const busy = transcribing || translating || normalizing
  const retry = job?.state !== 'completed' ? job?.audioDocumentId ?? recoverable : undefined
  const run = (resume?: string): void => { void runVideoEditSubtitleJob(instance, sequence.id, scope, trackId || undefined, { ...subtitleOptions, language }, resume).catch(error => { if (mounted.current) onError(error) }) }
  const applyStyle = (selected = false): void => { try { styleVideoEditSubtitles(instance.document.id, sequence.id, style, selected && selectedCaptionId ? [selectedCaptionId] : undefined) } catch (error) { onError(error) } }
  const changeStyle = (value: VideoEditSubtitleStyle): void => { setPresetId(''); setStyle(value) }
  const normalize = (): void => {
    const controller = new AbortController(); normalization.current = controller; setNormalizing(true)
    void segmentVideoEditSubtitles(instance.document.id, sequence.id, subtitleOptions, undefined, controller.signal).catch(error => { if (mounted.current && !controller.signal.aborted) onError(error) }).finally(() => { if (mounted.current) setNormalizing(false); if (normalization.current === controller) normalization.current = undefined })
  }
  const translate = (): void => {
    const controller = new AbortController(); translation.current = controller; setTranslating(true)
    void confirmVideoEditBilingualSubtitles(instance.document.id, sequence.id, { targetLanguage }, controller.signal).catch(error => { if (mounted.current && !controller.signal.aborted) onError(error) }).finally(() => { if (mounted.current) setTranslating(false); if (translation.current === controller) translation.current = undefined })
  }
  return <PanelTrigger open={open} onOpenChange={setOpen} panelSize="compact" zIndex={Z_LAYERS.dropdown} renderPanel={() => <div className="flex max-h-96 flex-col gap-3 overflow-auto">
    <UiGroup title="自动字幕" titleTone="compact">
      <UiFormRow label="范围" density="compact"><Dropdown ariaLabel="字幕转录范围" size="sm" value={scope} onSelect={setScope} disabled={sequence.captionTrackLocked || busy} options={[{ value: 'sequence', label: '整个序列' }, { value: 'in-out', label: '序列入出点' }, { value: 'selection', label: '选中片段' }]} /></UiFormRow>
      <UiFormRow label="声音" density="compact"><Dropdown ariaLabel="字幕声音来源" size="sm" value={trackId} onSelect={setTrackId} disabled={sequence.captionTrackLocked || busy} options={[{ value: '', label: '可听混音' }, ...sequence.tracks.map(track => ({ value: track.id, label: track.name }))]} /></UiFormRow>
      <UiFormRow label="语言" density="compact"><Dropdown ariaLabel="字幕识别语言" size="sm" value={language} onSelect={setLanguage} disabled={sequence.captionTrackLocked || busy} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: '英语' }]} /></UiFormRow>
      <UiFormRow label="字幕规范" density="compact"><Dropdown ariaLabel="字幕规范" size="sm" value={subtitleProfile} onSelect={value => { setSubtitleProfile(value); if (value === 'netflix_zh_hans') { setMaxCharacters(netflix.maxCharacters); setMaxLines(netflix.maxLines); setMinimum(netflix.minDurationSeconds) } }} disabled={sequence.captionTrackLocked || busy} options={[{ value: 'netflix_zh_hans', label: 'Netflix 简体中文' }, { value: 'custom', label: '自定义' }]} /></UiFormRow>
      <UiFormRow label="每行最多字数" info="长句会自动拆分；部分识别结果的拆分时刻为估算值，生成后可校正。" density="compact"><NumberInput ariaLabel="每行最多字数" size="sm" value={maxCharacters} min={1} step={1} precision={0} disabled={sequence.captionTrackLocked || busy} onChange={value => { setSubtitleProfile('custom'); setMaxCharacters(value) }} /></UiFormRow>
      <UiFormRow label="每条最多行数" density="compact"><NumberInput ariaLabel="每条字幕最多行数" size="sm" value={maxLines} min={1} step={1} precision={0} disabled={sequence.captionTrackLocked || busy} onChange={value => { setSubtitleProfile('custom'); setMaxLines(value) }} /></UiFormRow>
      {subtitleProfile === 'custom' && <UiFormRow label="停顿断句（秒）" density="compact"><NumberInput ariaLabel="字幕停顿断句秒数" size="sm" value={pauseSeconds} min={.01} step={.05} precision={2} disabled={sequence.captionTrackLocked || busy} onChange={setPauseSeconds} /></UiFormRow>}
      <UiFormRow label="最短显示（秒）" density="compact"><NumberInput ariaLabel="字幕最短显示秒数" size="sm" value={minDurationSeconds} min={0} max={netflix.maxDurationSeconds} step={.1} precision={3} disabled={sequence.captionTrackLocked || busy} onChange={value => { setSubtitleProfile('custom'); setMinimum(value) }} /></UiFormRow>
      <p className={UI_TEXT_META_CLASS}>语音识别按所选模型计费。</p>
      {models === 'loading' && <UiLoading size="xs" message={t('subtitles.modelsLoading')} />}
      {models === 'failed' && <UiError size="xs" title={t('subtitles.modelsFailed')} message="" retryLabel={t('actions.retry')} onRetry={() => setModelAttempt(value => value + 1)} />}
      {models === 'unconfigured' && <UiEmpty title={t('subtitles.modelsUnconfigured')} description={t('subtitles.configureModels')} size="sm" />}
      <div className="flex flex-wrap items-center gap-2"><UiButton size="sm" variant="primary" disabled={sequence.captionTrackLocked || busy || models !== 'configured'} onClick={() => run()}>转录并生成字幕</UiButton>{retry && <UiButton size="sm" disabled={sequence.captionTrackLocked || busy} onClick={() => run(retry)}>继续上次转录</UiButton>}</div>
      <UiButton size="sm" disabled={sequence.captionTrackLocked || busy || !sequence.captions?.length} onClick={normalize}>规范化已有字幕</UiButton>
      {normalizing && <UiLoading size="xs" message="正在整理字幕"><UiButton size="sm" onClick={() => normalization.current?.abort()}>取消</UiButton></UiLoading>}
      {transcribing && <UiLoading size="xs" message={job?.state === 'preparing' ? `准备声音 ${Math.round(job.progress * 100)}%` : job?.state === 'confirming' ? '等待费用确认' : '正在识别声音'}><UiButton size="sm" onClick={() => cancelSubtitleJob(instance, sequence.id)}>取消</UiButton></UiLoading>}
    </UiGroup>
    <UiGroup title="统一字幕样式" titleTone="compact" divided>
      <UiFormRow label="样式预设" density="compact"><Dropdown ariaLabel="字幕样式预设" size="sm" value={presetId} options={[{ value: '', label: '自定义样式' }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))]} onSelect={id => { setPresetId(id); const preset = presets.find(preset => preset.id === id); if (preset) setStyle(preset.style) }} /></UiFormRow>
      <VideoEditTypographyPanel key={`${instance.document.id}:${sequence.id}:${selectedCaptionId ?? ''}`} onBegin={beginTypography} onEnd={endTypography} style={scaleVideoEditTextStyle(typography, sequence.height / 1080)} fontLabel="字幕字体" onError={onError} onFontPreview={previewFont} projectFonts={collectVideoEditFonts(instance.document).map(use => use.font)} onChange={typography => {
        const next = videoEditSubtitleStyleSchema.parse({ ...scaleVideoEditTextStyle(typography, 1080 / sequence.height), bottomMargin: style.bottomMargin })
        if (sequence.captions?.length) styleVideoEditSubtitles(instance.document.id, sequence.id, next, selectedCaptionId ? [selectedCaptionId] : undefined, typographyGesture.handle.current); changeStyle(next)
      }} />
      <UiFormRow label="底部安全区（%）" density="compact"><NumberInput ariaLabel="字幕底部安全区百分比" size="sm" value={style.bottomMargin * 100} min={0} max={100} step={1} onChange={value => changeStyle({ ...style, bottomMargin: value / 100 })} /></UiFormRow>
      <div className="flex flex-wrap items-center gap-2"><UiButton size="sm" disabled={sequence.captionTrackLocked || busy || !sequence.captions?.length} onClick={() => applyStyle()}>应用全部</UiButton><UiButton size="sm" disabled={sequence.captionTrackLocked || busy || !selectedCaptionId} onClick={() => applyStyle(true)}>应用选中</UiButton></div>
    </UiGroup>
    <UiGroup title="双语字幕" titleTone="compact" divided>
      <UiFormRow label="第二语言" density="compact"><Dropdown ariaLabel="字幕第二语言" size="sm" value={targetLanguage} onSelect={setTargetLanguage} disabled={sequence.captionTrackLocked || busy} options={[{ value: 'en', label: '英语' }, { value: 'zh', label: '中文' }, { value: 'ja', label: '日语' }, { value: 'ko', label: '韩语' }, { value: 'fr', label: '法语' }, { value: 'es', label: '西班牙语' }, { value: 'de', label: '德语' }]} /></UiFormRow>
      <UiButton size="sm" disabled={sequence.captionTrackLocked || busy || !sequence.captions?.length} onClick={translate}>{translating ? '正在翻译…' : '生成第二语言'}</UiButton>
      {translating && <UiLoading size="xs" message="正在翻译字幕…" />}
      {translating && <UiButton size="sm" onClick={() => translation.current?.abort(new Error('双语字幕已取消。'))}>取消翻译</UiButton>}
    </UiGroup>
  </div>}>
    {({ togglePanel, open }) => <UiButton size="sm" aria-label="自动字幕与样式" aria-haspopup="dialog" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>{busy ? '处理…' : '转录'}</UiButton>}
  </PanelTrigger>
}
