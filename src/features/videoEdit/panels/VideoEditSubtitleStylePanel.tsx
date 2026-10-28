import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Palette } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiFormRow, UiIconButton, UiSwitch, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import { EffectSection } from '@/components/effects/EffectSection'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { scaleVideoEditTextStyle } from '@/core/videoEdit/text'
import { videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import { collectVideoEditFonts } from '@/core/videoEdit/fonts'
import { styleVideoEditSubtitles } from '../application/videoEditAutoSubtitles'
import { updateVideoEditTimedContent } from '../application/videoEditTimedContent'
import { subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { listVideoEditSubtitlePresets } from '../application/videoEditSubtitlePresets'
import { useVideoEditTypographyGesture } from './useVideoEditTypographyGesture'
import { useVideoEditFontPreview } from './useVideoEditFontPreview'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'

interface Props { instance: VideoEditInstance; sequenceId: string; selectedCaptionId?: string; onError: (error: unknown) => void }

/**
 * “全局样式”与当前预设按序列存一份（视图状态，不进文档）：效果控件与字幕面板底栏的样式浮层读写同一份，两处不会各说各的。
 */
interface StyleScope { global: boolean; presetId: string }
const DEFAULT_SCOPE: StyleScope = { global: true, presetId: '' }
const scopes = new WeakMap<VideoEditInstance, Map<string, StyleScope>>()
const scopeListeners = new Set<() => void>()
let scopeRevision = 0
const subscribeScope = (listener: () => void): (() => void) => { scopeListeners.add(listener); return () => { scopeListeners.delete(listener) } }
const readScope = (instance: VideoEditInstance, sequenceId: string): StyleScope => scopes.get(instance)?.get(sequenceId) ?? DEFAULT_SCOPE
function writeScope(instance: VideoEditInstance, sequenceId: string, patch: Partial<StyleScope>): void {
  const current = readScope(instance, sequenceId)
  if (Object.entries(patch).every(([key, value]) => current[key as keyof StyleScope] === value)) return
  const owned = scopes.get(instance) ?? new Map<string, StyleScope>(); scopes.set(instance, owned)
  owned.set(sequenceId, { ...current, ...patch }); scopeRevision++; scopeListeners.forEach(listener => listener())
}

/** 样式字段为什么不能改；能改时为 undefined。 */
function unavailableReason(sequence: { captions?: readonly unknown[]; captionTrackLocked?: boolean } | undefined, global: boolean, selectedCaptionId: string | undefined): string | undefined {
  if (!sequence?.captions?.length) return '序列里还没有字幕'
  if (sequence.captionTrackLocked) return '字幕轨道已锁定，请先解锁'
  if (!global && !selectedCaptionId) return '“全局样式”已关闭：先选中一条字幕，或打开“全局样式”'
  return undefined
}

/**
 * 字幕样式（重要记录 019）：样式只存在每条字幕上，序列没有自己的样式。“全局样式”默认开，改动写进这条序列的全部字幕；
 * 关掉后只改选中的那条；没选中、字幕轨锁定或没有字幕时字段不出现，只说明原因。每次修改一步撤销，拖动数值整笔一步。
 */
export function VideoEditSubtitleStyleFields({ instance, sequenceId, selectedCaptionId, onError }: Props): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const sequence = instance.document.sequences.find(value => value.id === sequenceId)
  useSyncExternalStore(subscribeScope, () => scopeRevision)
  const { global, presetId } = readScope(instance, sequenceId)
  const setPresetId = (value: string): void => writeScope(instance, sequenceId, { presetId: value })
  const targets: readonly string[] | undefined = global ? undefined : selectedCaptionId ? [selectedCaptionId] : []
  const reason = unavailableReason(sequence, global, selectedCaptionId)
  const applicable = !reason
  const presets = listVideoEditSubtitlePresets()
  const currentCaption = selectedCaptionId ? sequence?.captions?.find(cue => cue.id === selectedCaptionId) : sequence?.captions?.[0]
  const [style, setStyle] = useState<VideoEditSubtitleStyle>(() => currentCaption?.style || videoEditSubtitleStyleSchema.parse({}))
  useEffect(() => { setStyle(currentCaption?.style || videoEditSubtitleStyleSchema.parse({})) }, [currentCaption?.id, currentCaption?.style, selectedCaptionId, sequenceId])
  const scope = `${sequenceId}:subtitle:${selectedCaptionId ?? ''}`
  const typographyGesture = useVideoEditTypographyGesture(instance.document.id, scope, onError)
  const typographyBaseline = useRef<VideoEditSubtitleStyle>()
  const previewFont = useVideoEditFontPreview(instance.document.id, scope, onError, (fontFamily, gesture) => { if (applicable) styleVideoEditSubtitles(instance.document.id, sequenceId, { ...style, fontFamily }, targets, gesture) })
  if (!sequence) return null
  const { bottomMargin: _bottomMargin, ...typography } = style
  const beginTypography = (): void => { typographyBaseline.current ??= style; if (sequence.captions?.length) typographyGesture.begin() }
  const endTypography = (commit: boolean): void => { typographyGesture.end(commit); const baseline = typographyBaseline.current; typographyBaseline.current = undefined; if (!commit && baseline) setStyle(baseline) }
  const applyStyle = (value: VideoEditSubtitleStyle): void => { if (!applicable) return; try { styleVideoEditSubtitles(instance.document.id, sequenceId, value, targets) } catch (error) { onError(error) } }
  const changeStyle = (value: VideoEditSubtitleStyle): void => { setPresetId(''); setStyle(value) }
  return <div className="flex flex-col gap-2" data-video-edit-subtitle-style>
    <UiFormRow label="全局样式" info="开着时改动作用于这条序列的全部字幕；关掉后只改选中的字幕。" density="compact" inline><UiSwitch aria-label="全局样式" checked={global} disabled={!sequence.captions?.length || sequence.captionTrackLocked} onCheckedChange={value => writeScope(instance, sequenceId, { global: value })} /></UiFormRow>
    {reason ? <UiEmpty size="sm" title={reason} /> : <>
    <UiFormRow label="样式预设" density="compact"><Dropdown ariaLabel="字幕样式预设" size="sm" value={presetId} options={[{ value: '', label: '自定义样式' }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))]} onSelect={id => { setPresetId(id); const preset = presets.find(preset => preset.id === id); if (preset) { setStyle(preset.style); applyStyle(preset.style) } }} /></UiFormRow>
    <VideoEditTypographyPanel key={`${instance.document.id}:${scope}`} onBegin={beginTypography} onEnd={endTypography} style={scaleVideoEditTextStyle(typography, sequence.height / 1080)} fontLabel="字幕字体" onError={onError} onFontPreview={previewFont} projectFonts={collectVideoEditFonts(instance.document).map(use => use.font)} onChange={typography => {
      const next = videoEditSubtitleStyleSchema.parse({ ...scaleVideoEditTextStyle(typography, 1080 / sequence.height), bottomMargin: style.bottomMargin })
      if (applicable) styleVideoEditSubtitles(instance.document.id, sequenceId, next, targets, typographyGesture.handle.current); changeStyle(next)
    }} />
    <UiFormRow label="底部安全区（%）" density="compact"><NumberInput ariaLabel="字幕底部安全区百分比" size="sm" value={style.bottomMargin * 100} min={0} max={100} step={1} onChange={value => { const next = { ...style, bottomMargin: value / 100 }; changeStyle(next); applyStyle(next) }} /></UiFormRow>
    </>}
  </div>
}

/** 「字幕与标记」底栏的样式入口：与效果控件里的是同一组字段。 */
export function VideoEditSubtitleStyleButton(props: Props): React.ReactElement {
  const sequence = props.instance.document.sequences.find(value => value.id === props.sequenceId)
  // 入口只看有没有字幕、轨道锁没锁；“全局样式”关着又没选中字幕时由浮层里说明，开关仍可在浮层里打开。
  const reason = unavailableReason(sequence, true, undefined)
  return <PanelTrigger panelSize="compact" panelPadding="content" zIndex={Z_LAYERS.dropdown} disabled={Boolean(reason)} renderPanel={() => <div className="flex max-h-96 flex-col overflow-auto"><VideoEditSubtitleStyleFields {...props} /></div>}>
    {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="字幕样式" tooltip="字幕样式" disabled={Boolean(reason)} disabledReason={reason} aria-haspopup="dialog" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><Palette /></UiIconButton>}
  </PanelTrigger>
}

/** 效果控件里选中字幕时显示的内容（对齐 PR 选中字幕后的属性）：字幕名一行、剪辑后复核、字幕样式。 */
export function VideoEditSubtitleInspector({ instance, sequenceId, captionId, onError }: { instance: VideoEditInstance; sequenceId: string; captionId: string; onError: (error: unknown) => void }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const sequence = instance.document.sequences.find(value => value.id === sequenceId)
  const caption = sequence?.captions?.find(value => value.id === captionId)
  if (!sequence || !caption) return null
  const confirmReview = (): void => { try { updateVideoEditTimedContent(instance.document.id, sequence.id, 'caption', caption.id, { reviewReasons: [] }) } catch (error) { onError(error) } }
  return <div data-video-edit-effects-caption={caption.id}>
    <div className="flex h-band-title shrink-0 items-center pl-3 pr-2">
      <span className="min-w-0 flex-1 truncate text-13 font-semibold text-text1" title={caption.text} data-user-content>{caption.text}</span>
    </div>
    {Boolean(caption.reviewReasons?.length) && <EffectSection id="caption-review" title="剪辑后复核">
      <div className={`flex flex-col items-start gap-2 py-1 ${UI_PROPERTY_INSET_CLASS}`}>
        <p className={UI_TEXT_META_CLASS}>这条字幕有待核对的内容。请核对正文、译文与声音是否对应，并检查显示时间。</p>
        <UiButton size="sm" disabled={sequence.captionTrackLocked} disabledReason={sequence.captionTrackLocked ? '字幕轨道已锁定，请先解锁。' : undefined} onClick={confirmReview}>确认已检查</UiButton>
      </div>
    </EffectSection>}
    <EffectSection id="subtitle-style" title="字幕样式">
      <div className="pl-5"><VideoEditSubtitleStyleFields instance={instance} sequenceId={sequence.id} selectedCaptionId={caption.id} onError={onError} /></div>
    </EffectSection>
  </div>
}
