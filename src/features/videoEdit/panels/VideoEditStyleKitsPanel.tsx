import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiColorInput, UiEasingEditor, UiEmpty, UiError, UiFontPicker, UiFormRow, UiGroup, UiInput, UiSegmented, UiSwitch, UiTextArea } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { STYLE_PALETTE_KEYS, STYLE_FONT_KEYS, STYLE_MOTION_ROLES, styleTokensSchema, styleColorHex, styleColorFromHex, styleEasingBezier, styleEasingOvershoots, styleKitPromptHint, resolveVideoEditStyleKit, type StyleKit, type StyleRhythm, type StyleTokens } from '@/core/videoEdit/styleKit'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { CODE_EASE_NAMES } from '@/core/videoEdit/codeMaterial/motion'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { applyStyleKitToSequence, applyStyleKitToClips, captureVideoEditStyleSample, checkStyleKit, copyAvailableStyleKit, extractVideoEditWorkStyle } from '../application/videoEditStyleKits'
import { videoEditStyleKitLibrary } from '../application/videoEditStyleKitLibrary'
import { extractVideoEditReferenceStyle } from '../application/videoEditStyleReference'
import { insertVideoEditStyleSample } from '../application/videoEditStyleSamples'
import { getActiveVideoEditSequence, requireVideoEditInstance, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditStyleKitPreview } from './VideoEditStyleKitPreview'
import { StyleKitProfileEditor, StyleKitRulesEditor } from './VideoEditStyleKitIntent'
import { normalizeStyleKitDraft, styleKitDraftProblem } from '../application/videoEditStyleKitDraft'

const PALETTE_LABELS = ['背景', '底板', '正文', '辅助', '强调', '次强调', '正向', '负向']
const FONT_LABELS = ['标题', '正文', '等宽']
/** Draft edits commit on apply, so curve drags need no gesture grouping. */
const noop = (): void => {}
const MOTION_LABELS = { enter: '入场', exit: '出场', move: '移动', emphasis: '强调', transition: '转场' } as const
const RHYTHM_OPTIONS: { [K in Exclude<keyof StyleRhythm, 'shotSeconds' | 'notes'>]: { label: string; options: Array<{ value: StyleRhythm[K]; label: string }> } } = {
  cutOn: { label: '切点', options: [{ value: 'auto', label: '不限' }, { value: 'speech', label: '语句' }, { value: 'beat', label: '音乐节拍' }, { value: 'action', label: '动作' }] },
  transition: { label: '主转场', options: [{ value: 'auto', label: '不限' }, { value: 'cut', label: '硬切' }, { value: 'dissolve', label: '叠化' }, { value: 'match', label: '匹配切' }, { value: 'wipe', label: '划像' }, { value: 'zoom', label: '推拉' }] },
  sfx: { label: '音效', options: [{ value: 'auto', label: '不限' }, { value: 'none', label: '不用' }, { value: 'sparse', label: '少量' }, { value: 'rich', label: '丰富' }] },
  musicDucking: { label: '人声时音乐', options: [{ value: 'auto', label: '不限' }, { value: 'on', label: '压低' }, { value: 'off', label: '不压低' }] },
}
const EASE_LABELS: Record<string, string> = { linear: '匀速', backOut: '回弹', elasticOut: '弹性', bounceOut: '跳动', sineIn: '柔和入', sineOut: '柔和出', sineInOut: '柔和', quadIn: '渐快', quadOut: '渐慢', quadInOut: '平缓', cubicIn: '收束', cubicOut: '顺滑', cubicInOut: '顺滑移动', quartIn: '加速', quartOut: '利落', quartInOut: '利落移动', quintIn: '快速入', quintOut: '快速出', quintInOut: '快速移动', expoIn: '锐利入', expoOut: '锐利出', expoInOut: '锐利移动', circIn: '弧形入', circOut: '弧形出', circInOut: '弧形移动' }
function Panel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const { t: surfaceText } = useTranslation('ui')
  const sequence = getActiveVideoEditSequence(instance); const projectId = instance.document.id; const baseline = instance.document
  const current = resolveVideoEditStyleKit(instance.document, sequence)
  const currentRef = useRef(current); currentRef.current = current
  const [draft, setDraft] = useState<StyleKit>(() => structuredClone(current ?? BUILTIN_STYLE_KITS[0]))
  const [selected, setSelected] = useState(current ? `project:${current.id}` : `preset:${BUILTIN_STYLE_KITS[0].id}`)
  const [reference, setReference] = useState(''); const [seconds, setSeconds] = useState(0)
  const [sampleId, setSampleId] = useState(draft.samples[0]?.id ?? '')
  const [notesOpen, setNotesOpen] = useState(false)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [, refreshLibrary] = useState(0)
  const abort = useRef<AbortController>(); const ownerIdentity = useRef('')
  ownerIdentity.current = `${projectId}:${sequence.id}`
  const asset = useAssetLibraryStore(state => state.selectedAsset)
  const run = async (action: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setBusy(true); setError('')
    try { if (requireVideoEditInstance(projectId) !== instance) throw new Error('原剪辑已关闭。'); await action(controller.signal) }
    catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '风格操作失败，请重试。'); onError(reason) } }
    finally { if (abort.current === controller) { abort.current = undefined; setBusy(false) } }
  }
  const guard = (signal: AbortSignal): void => { signal.throwIfAborted(); if (ownerIdentity.current !== `${projectId}:${sequence.id}` || requireVideoEditInstance(projectId) !== instance || instance.document !== baseline) throw new Error('原剪辑或序列已修改，请重新操作。') }
  useEffect(() => { const kit = currentRef.current; const next = structuredClone(kit ?? BUILTIN_STYLE_KITS[0]); setDraft(next); setSelected(kit ? `project:${kit.id}` : `preset:${next.id}`) }, [projectId, sequence.id, current?.id, current?.revision])
  useEffect(() => { if (!draft.samples.some(sample => sample.id === sampleId)) setSampleId(draft.samples[0]?.id ?? '') }, [draft.samples, sampleId])
  useEffect(() => {
    const controller = new AbortController(); const document = instance.document
    if (!currentRef.current) {
      abort.current = controller; setBusy(true)
      void copyAvailableStyleKit(BUILTIN_STYLE_KITS[0], controller.signal).then(value => {
        controller.signal.throwIfAborted()
        if (requireVideoEditInstance(projectId) !== instance || instance.document !== document) return
        setDraft({ ...value, name: BUILTIN_STYLE_KITS[0].name })
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '风格字体读取失败。') }).finally(() => { if (abort.current === controller) { abort.current = undefined; setBusy(false) } })
    }
    return () => { controller.abort(); abort.current?.abort(); abort.current = undefined }
  }, [instance, projectId, sequence.id])
  useEffect(() => { if (!visible) { abort.current?.abort(); abort.current = undefined; setBusy(false) } }, [visible])
  const tokens = draft.tokens
  const token = <G extends keyof StyleTokens>(group: G, key: keyof StyleTokens[G], value: unknown): void => {
    const result = styleTokensSchema.safeParse({ ...draft.tokens, [group]: { ...draft.tokens[group], [key]: value } })
    if (!result.success) { const reason = new Error(result.error.issues.map(issue => issue.message).join('；')); setError(reason.message); onError(reason); return }
    setDraft(previous => ({ ...previous, tokens: result.data }))
  }
  const edit = (update: (kit: StyleKit) => StyleKit): void => setDraft(previous => update(previous))
  const rhythm = (patch: Partial<StyleRhythm>): void => setDraft(previous => ({ ...previous, rhythm: { ...previous.rhythm, ...patch } }))
  const easePresets = CODE_EASE_NAMES.filter(name => tokens.motion.allowOvershoot || !styleEasingOvershoots(name)).map(value => ({ value, label: EASE_LABELS[value], curve: styleEasingBezier(value) }))
  /** One completeness check for every commit path, then the shared schema/sample/font validation. */
  const prepare = async (signal: AbortSignal): Promise<StyleKit> => { const value = normalizeStyleKitDraft(draft); const problem = styleKitDraftProblem(value); if (problem) throw new Error(problem); return checkStyleKit(value, signal) }
  const number = (label: string, value: number, onChange: (value: number) => void, min = 0, max = Number.MAX_SAFE_INTEGER, step = .01): React.ReactElement => <UiFormRow key={label} label={label} density="compact"><NumberInput ariaLabel={label} size="sm" value={value} min={min} max={max} step={step} onChange={onChange} /></UiFormRow>
  const choose = (value: string): void => { void run(async signal => { const kit = value.startsWith('project:') ? instance.document.styleKits?.find(kit => kit.id === value.slice(8)) : videoEditStyleKitLibrary.list().find(kit => kit.id === value.slice(7)); if (!kit) throw new Error('风格已删除，请重新选择。'); const next = value.startsWith('project:') ? structuredClone(kit) : { ...await copyAvailableStyleKit(kit, signal), name: kit.name }; guard(signal); setDraft(next); setSelected(value) }) }
  const references = instance.document.items.flatMap(item => { const media = instance.document.media.find(media => media.id === item.mediaId); return media && ['image', 'video'].includes(media.kind) ? [{ value: `item:${item.id}`, label: item.name }] : [] })
  if (asset?.mediaType === 'image') references.push({ value: `asset:${asset.id}`, label: '资产库所选图片' })
  const options = [...(instance.document.styleKits ?? []).map(kit => ({ value: `project:${kit.id}`, label: kit.name })), ...videoEditStyleKitLibrary.list().map(kit => ({ value: `preset:${kit.id}`, label: kit.name }))]
  const selectedPreset = selected.startsWith('preset:') ? videoEditStyleKitLibrary.custom().find(kit => kit.id === selected.slice(7)) : undefined
  return <UiGroup labelWidth={120} gap="stack" className="h-full min-h-0 overflow-y-auto p-3" data-video-edit-style-kits>
    {(error || videoEditStyleKitLibrary.loadError()) && <UiError size="sm" message={error || videoEditStyleKitLibrary.loadError()} />}
    <UiFormRow label="风格" density="compact"><Dropdown ariaLabel="选择风格" size="sm" value={selected} options={options} disabled={busy} onSelect={choose} /></UiFormRow>
    <VideoEditStyleKitPreview kit={draft} width={Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator)} height={sequence.height} visible={visible} />
    <UiFormRow label="名称" density="compact"><UiInput size="sm" aria-label="风格名称" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></UiFormRow>
    <div className="flex flex-wrap gap-2"><UiButton size="sm" variant="primary" disabled={busy || !draft.name.trim()} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); const value = applyStyleKitToSequence(projectId, sequence.id, checked); setDraft(value); setSelected(`project:${value.id}`) }) }}>应用到序列</UiButton><UiButton size="sm" disabled={busy || !instance.selectedClipIds.length || !draft.name.trim()} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); const value = applyStyleKitToClips(projectId, sequence.id, checked, instance.selectedClipIds); setDraft(value); setSelected(`project:${value.id}`) }) }}>覆盖所选片段风格</UiButton><UiButton size="sm" disabled={busy || !draft.name.trim()} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); const value = videoEditStyleKitLibrary.save(checked); setSelected(`preset:${value.id}`); refreshLibrary(value => value + 1) }) }}>另存到风格库</UiButton>{selectedPreset && <UiButton size="sm" disabled={busy} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); videoEditStyleKitLibrary.update(selectedPreset.id, checked); refreshLibrary(value => value + 1) }) }}>更新个人预设</UiButton>}{selectedPreset && <UiButton size="sm" variant="danger" disabled={busy} onClick={() => { void run(async signal => { guard(signal); videoEditStyleKitLibrary.remove(selectedPreset.id); setDraft(structuredClone(current ?? draft)); setSelected(current ? `project:${current.id}` : `preset:${BUILTIN_STYLE_KITS[0].id}`); refreshLibrary(value => value + 1) }) }}>删除个人预设</UiButton>}{busy && <UiButton size="sm" onClick={() => abort.current?.abort()}>取消</UiButton>}</div>
    <UiGroup title="提取候选" titleTone="compact">
      <UiButton size="sm" disabled={busy} onClick={() => { void run(async signal => { const value = await extractVideoEditWorkStyle(projectId, sequence.id, '作品风格', signal); guard(signal); setDraft(value) }) }}>从当前作品提取</UiButton>
      <UiFormRow label="参考" density="compact"><Dropdown ariaLabel="风格参考素材" size="sm" value={reference} display={reference ? undefined : '图片或视频'} options={references} disabled={busy} onSelect={value => { setReference(value); setSeconds(0) }} /></UiFormRow>
      {reference.startsWith('item:') && number('参考时刻（秒）', seconds, setSeconds)}
      <UiButton size="sm" disabled={busy || !reference} onClick={() => { void run(async signal => { const target = reference.startsWith('asset:') ? { kind: 'asset' as const, assetId: reference.slice(6) } : { kind: 'item' as const, projectId, itemId: reference.slice(5), timeUs: Math.round(seconds * 1e6) }; const value = await extractVideoEditReferenceStyle(target, draft, '参考风格', signal); guard(signal); setDraft(value) }) }}>从参考提取配色</UiButton>
    </UiGroup>
    <StyleKitProfileEditor kit={draft} onChange={edit} />
    <StyleKitRulesEditor kit={draft} onChange={edit} />
    <UiGroup title="配色" titleTone="compact">{STYLE_PALETTE_KEYS.map((key, index) => <UiFormRow key={key} label={PALETTE_LABELS[index]} density="compact"><div className="flex gap-2"><UiColorInput aria-label={`风格${PALETTE_LABELS[index]}`} value={styleColorHex(tokens.palette[key])} onChange={event => token('palette', key, styleColorFromHex(event.target.value, tokens.palette[key][3]))} /><NumberInput ariaLabel={`${PALETTE_LABELS[index]}不透明度`} size="sm" value={tokens.palette[key][3] * 100} min={0} max={100} onChange={value => token('palette', key, [...tokens.palette[key].slice(0, 3), value / 100])} /></div></UiFormRow>)}</UiGroup>
    <UiGroup title="字体与字号" titleTone="compact">{STYLE_FONT_KEYS.map((key, index) => <UiFormRow key={key} label={FONT_LABELS[index]} density="compact"><UiFontPicker ariaLabel={`风格${FONT_LABELS[index]}字体`} size="sm" value={tokens.fonts[key].family} disabled={busy} onSelect={(_name, face) => token('fonts', key, { family: face.fullName, weight: face.weight })} /></UiFormRow>)}{number('基准字号（画高 %）', tokens.typeScale.baseSize * 100, value => token('typeScale', 'baseSize', value / 100), .1, 10)}<UiFormRow label="字号比例" density="compact"><Dropdown ariaLabel="字号比例" size="sm" value={String(tokens.typeScale.ratio)} options={[1.25, 1.333, 1.5, 2].map(value => ({ value: String(value), label: String(value) }))} onSelect={value => token('typeScale', 'ratio', Number(value))} /></UiFormRow></UiGroup>
    <UiGroup title="形状与布局" titleTone="compact">{(['radius', 'strokeWidth', 'spacing1', 'spacing2', 'spacing3'] as const).map((key, index) => number(['圆角', '描边', '小间距', '中间距', '大间距'][index] + '（画高 %）', tokens.shape[key] * 100, value => token('shape', key, value / 100), 0, 100))}{number('安全边距（画幅 %）', tokens.layout.safeMargin * 100, value => token('layout', 'safeMargin', value / 100), 0, 45)}{number('网格列数', tokens.layout.grid, value => token('layout', 'grid', Math.round(value)), 1, Number.MAX_SAFE_INTEGER, 1)}</UiGroup>
    <UiGroup title="动效" titleTone="compact">
      {(['enterDuration', 'exitDuration', 'emphasisDuration', 'transitionDuration', 'stagger'] as const).map((key, index) => number(['入场（秒）', '出场（秒）', '强调（秒）', '转场（秒）', '逐项间隔（秒）'][index], tokens.motion[key], value => token('motion', key, value), key === 'stagger' ? 0 : .001))}
      {STYLE_MOTION_ROLES.map(role => <UiFormRow key={role} label={`${MOTION_LABELS[role]}曲线`} density="compact"><UiEasingEditor size="sm" aria-label={`${MOTION_LABELS[role]}曲线`} value={tokens.motion[`${role}Ease`]} presets={easePresets} onBegin={noop} onFinish={noop} onCancel={noop} onChange={value => token('motion', `${role}Ease`, value)} /></UiFormRow>)}
      <UiFormRow label="允许回弹" density="compact"><UiSwitch aria-label="允许回弹" checked={tokens.motion.allowOvershoot} onCheckedChange={value => setDraft(previous => ({ ...previous, tokens: styleTokensSchema.parse({ ...previous.tokens, motion: { ...previous.tokens.motion, allowOvershoot: value, ...(!value ? Object.fromEntries(STYLE_MOTION_ROLES.map(role => [`${role}Ease`, styleEasingOvershoots(previous.tokens.motion[`${role}Ease`]) ? 'cubicOut' : previous.tokens.motion[`${role}Ease`]])) : {}) } }) }))} /></UiFormRow>
      {number('位移幅度（画高 %）', tokens.motion.travel * 100, value => token('motion', 'travel', value / 100), 0, 100)}
      <UiFormRow label="落地静止" density="compact"><UiSwitch aria-label="落地静止" checked={tokens.motion.settle} onCheckedChange={value => token('motion', 'settle', value)} /></UiFormRow>
      {number('读字速度（字/秒）', tokens.motion.readingSpeed, value => token('motion', 'readingSpeed', value), .5, 40, .5)}
      {number('读完停留（秒）', tokens.motion.minHold, value => token('motion', 'minHold', value), 0, 60, .1)}
      <UiFormRow label="动作对齐" density="compact"><UiSegmented ariaLabel="动作对齐" size="sm" value={tokens.motion.sync} options={[{ value: 'speech', label: '语句' }, { value: 'beat', label: '节拍' }, { value: 'free', label: '不限' }]} onChange={value => token('motion', 'sync', value)} /></UiFormRow>
    </UiGroup>
    <UiGroup title="节奏" titleTone="compact">
      <UiFormRow label="限定镜头时长" density="compact"><UiSwitch aria-label="限定镜头时长" checked={draft.rhythm.shotSeconds !== null} onCheckedChange={value => rhythm({ shotSeconds: value ? { min: 2, max: 4 } : null })} /></UiFormRow>
      {draft.rhythm.shotSeconds && <>{number('最短（秒）', draft.rhythm.shotSeconds.min, value => rhythm({ shotSeconds: { min: value, max: Math.max(value, draft.rhythm.shotSeconds!.max) } }), .1, 600, .1)}{number('最长（秒）', draft.rhythm.shotSeconds.max, value => rhythm({ shotSeconds: { min: Math.min(value, draft.rhythm.shotSeconds!.min), max: value } }), .1, 600, .1)}</>}
      {(Object.keys(RHYTHM_OPTIONS) as Array<keyof typeof RHYTHM_OPTIONS>).map(key => <UiFormRow key={key} label={RHYTHM_OPTIONS[key].label} density="compact"><Dropdown ariaLabel={RHYTHM_OPTIONS[key].label} size="sm" value={draft.rhythm[key]} options={RHYTHM_OPTIONS[key].options} onSelect={value => rhythm({ [key]: value })} /></UiFormRow>)}
      <UiFormRow label="节奏说明" density="compact"><UiInput size="sm" aria-label="节奏说明" value={draft.rhythm.notes} onChange={event => rhythm({ notes: event.target.value })} /></UiFormRow>
    </UiGroup>
    <UiGroup title="字幕" titleTone="compact">
      <UiFormRow label="字幕处理" density="compact"><UiSegmented ariaLabel="字幕处理" size="sm" value={draft.caption.treatment} options={[{ value: 'outline', label: '描边' }, { value: 'plate', label: '底板' }, { value: 'pop', label: '花字' }]} onChange={value => setDraft(previous => ({ ...previous, caption: { ...previous.caption, treatment: value } }))} /></UiFormRow>
    </UiGroup>
    <UiGroup title="质感" titleTone="compact">{number('颗粒（%）', tokens.texture.grain * 100, value => token('texture', 'grain', value / 100), 0, 100)}{number('暗角（%）', tokens.texture.vignette * 100, value => token('texture', 'vignette', value / 100), 0, 100)}{number('辉光强度', tokens.texture.glowIntensity, value => token('texture', 'glowIntensity', value), 0, 16)}</UiGroup>
    <UiGroup title="生成" titleTone="compact">
      <UiFormRow label="生成时套用风格" density="compact"><UiSwitch aria-label="生成时套用风格" checked={draft.generation.inject} onCheckedChange={value => setDraft(previous => ({ ...previous, generation: { ...previous.generation, inject: value } }))} /></UiFormRow>
      {draft.generation.inject && <UiFormRow label="风格描述" density="compact"><UiInput size="sm" aria-label="生成风格描述" placeholder={styleKitPromptHint({ ...draft, generation: { inject: true, prompt: '' } })} value={draft.generation.prompt} onChange={event => setDraft(previous => ({ ...previous, generation: { ...previous.generation, prompt: event.target.value } }))} /></UiFormRow>}
    </UiGroup>
    <UiGroup title="样例组件" titleTone="compact"><UiFormRow label={surfaceText('surfaceGrammar.stylePreset')} density="compact" labelColumn="panel"><Dropdown ariaLabel="风格组件" size="sm" value={sampleId} options={draft.samples.map(sample => ({ value: sample.id, label: sample.name }))} onSelect={setSampleId} /></UiFormRow><UiButton size="sm" disabled={busy || !sampleId} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); await insertVideoEditStyleSample(projectId, sequence.id, checked, sampleId, undefined, signal) }) }}>添加到播放头</UiButton><UiButton size="sm" disabled={busy || !sequence.clips.find(clip => clip.id === instance.selection)?.code} onClick={() => { void run(async signal => { guard(signal); setDraft(captureVideoEditStyleSample(projectId, sequence.id, draft)) }) }}>将所选代码保存为组件</UiButton></UiGroup>
    <UiGroup title="补充说明" titleTone="compact"><UiButton size="sm" onClick={() => setNotesOpen(value => !value)}>{notesOpen ? '收起说明' : '编辑说明'}</UiButton>{notesOpen && <UiTextArea aria-label="风格补充说明" height="medium" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} />}</UiGroup>
  </UiGroup>
}
export function VideoEditStyleKitsPanel(props: Parameters<typeof Panel>[0]): React.ReactElement { return props.instance.activeSequenceId ? <Panel {...props} /> : <UiEmpty className="h-full" title="没有序列" /> }
