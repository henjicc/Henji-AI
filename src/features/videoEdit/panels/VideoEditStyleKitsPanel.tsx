import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Dropdown, UI_COVER_FRAME_CLASS, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiTextArea } from '@/components/ui'
import { STYLE_GUIDE_SECTIONS, composeStyleGuide, parseStyleGuide, resolveVideoEditStyleKit, type StyleKit } from '@/core/videoEdit/styleKit'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { applyStyleKitToSequence, captureVideoEditStyleExample, checkStyleKit, copyStyleKit } from '../application/videoEditStyleKits'
import { videoEditStyleKitLibrary } from '../application/videoEditStyleKitLibrary'
import { getActiveVideoEditSequence, requireVideoEditInstance, type VideoEditInstance } from '../application/videoEditService'
import { styleKitDraftProblem } from '../application/videoEditStyleKitDraft'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'

const PREVIEW_SIZE = { width: 320, height: 180 }
const fresh = (kit: StyleKit): StyleKit => ({ ...copyStyleKit(kit), name: kit.name })

/**
 * 风格面板：风格是给 AI 的说明书（按章节写的提示词）加几段参考示例。这里按章节编辑、绑定到序列、存入风格库；
 * 绑定只决定助手按哪份说明书创作，不改时间线上的任何东西。
 */
function Panel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance); const projectId = instance.document.id; const baseline = instance.document
  const current = resolveVideoEditStyleKit(instance.document, sequence)
  const currentRef = useRef(current); currentRef.current = current
  const [draft, setDraft] = useState<StyleKit>(() => current ? structuredClone(current) : fresh(BUILTIN_STYLE_KITS[0]))
  const [selected, setSelected] = useState(current ? `project:${current.id}` : `preset:${BUILTIN_STYLE_KITS[0].id}`)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [, refreshLibrary] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const abort = useRef<AbortController>(); const ownerIdentity = useRef('')
  ownerIdentity.current = `${projectId}:${sequence.id}`
  const run = async (action: (signal: AbortSignal) => Promise<void> | void): Promise<void> => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setBusy(true); setError('')
    try { if (requireVideoEditInstance(projectId) !== instance) throw new Error('原剪辑已关闭。'); await action(controller.signal) }
    catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '风格操作失败，请重试。'); onError(reason) } }
    finally { if (abort.current === controller) { abort.current = undefined; setBusy(false) } }
  }
  const guard = (signal: AbortSignal): void => { signal.throwIfAborted(); if (ownerIdentity.current !== `${projectId}:${sequence.id}` || requireVideoEditInstance(projectId) !== instance || instance.document !== baseline) throw new Error('原剪辑或序列已修改，请重新操作。') }
  useEffect(() => { const kit = currentRef.current; setDraft(kit ? structuredClone(kit) : fresh(BUILTIN_STYLE_KITS[0])); setSelected(kit ? `project:${kit.id}` : `preset:${BUILTIN_STYLE_KITS[0].id}`) }, [projectId, sequence.id, current?.id, current?.revision])
  useEffect(() => { if (!visible) { abort.current?.abort(); abort.current = undefined; setBusy(false); setPreviewing(false) } }, [visible])
  /** One completeness check for every commit path, then the shared schema and example validation. */
  const prepare = async (signal: AbortSignal): Promise<StyleKit> => { const problem = styleKitDraftProblem(draft); if (problem) throw new Error(problem); return checkStyleKit(draft, signal) }
  const choose = (value: string): void => { void run(signal => { const kit = value.startsWith('project:') ? instance.document.styleKits?.find(kit => kit.id === value.slice(8)) : videoEditStyleKitLibrary.list().find(kit => kit.id === value.slice(7)); if (!kit) throw new Error('风格已删除，请重新选择。'); guard(signal); setDraft(value.startsWith('project:') ? structuredClone(kit) : fresh(kit)); setSelected(value) }) }
  const sections = parseStyleGuide(draft.guide)
  const extras = sections.filter(section => section.title && !STYLE_GUIDE_SECTIONS.some(spec => spec.title === section.title))
  const writeSection = (title: string, body: string): void => setDraft(previous => {
    const parsed = parseStyleGuide(previous.guide); const index = parsed.findIndex(section => section.title === title)
    const next = index < 0 ? [...parsed, { title, body }] : parsed.map((section, position) => position === index ? { title, body } : section)
    return { ...previous, guide: composeStyleGuide(next) }
  })
  const editExample = (id: string, patch: Partial<StyleKit['examples'][number]>): void => setDraft(previous => ({ ...previous, examples: previous.examples.map(example => example.id === id ? { ...example, ...patch } : example) }))
  const previewSource = useMemo(() => ({ category: 'style' as const, kit: draft }), [draft])
  const options = [...(instance.document.styleKits ?? []).map(kit => ({ value: `project:${kit.id}`, label: kit.name })), ...videoEditStyleKitLibrary.list().map(kit => ({ value: `preset:${kit.id}`, label: kit.name }))]
  const selectedPreset = selected.startsWith('preset:') ? videoEditStyleKitLibrary.custom().find(kit => kit.id === selected.slice(7)) : undefined
  const selectedCode = Boolean(sequence.clips.find(clip => clip.id === instance.selection)?.code)
  const section = (title: string, hint: string): React.ReactElement => <UiGroup key={title} title={title} titleTone="compact">
    <UiTextArea aria-label={`说明书：${title}`} height={title === '定位' ? 'short' : 'medium'} placeholder={hint} value={sections.find(value => value.title === title)?.body ?? ''} onChange={event => writeSection(title, event.target.value)} />
  </UiGroup>
  return <UiGroup labelWidth={72} gap="stack" className="h-full min-h-0 overflow-y-auto p-3" data-video-edit-style-kits>
    {(error || videoEditStyleKitLibrary.loadError()) && <UiError size="sm" message={error || videoEditStyleKitLibrary.loadError()} />}
    <UiFormRow label="风格" density="compact"><Dropdown ariaLabel="选择风格" size="sm" value={selected} options={options} disabled={busy} onSelect={choose} /></UiFormRow>
    <UiFormRow label="名称" density="compact"><UiInput size="sm" aria-label="风格名称" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></UiFormRow>
    <div className="flex flex-wrap gap-2">
      <UiButton size="sm" variant="primary" disabled={busy || !draft.name.trim()} tooltip="助手在这个序列里按这份说明书创作" onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); const value = applyStyleKitToSequence(projectId, sequence.id, checked); setDraft(value); setSelected(`project:${value.id}`) }) }}>绑定到序列</UiButton>
      <UiButton size="sm" disabled={busy || !draft.name.trim()} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); const value = videoEditStyleKitLibrary.save(checked); setSelected(`preset:${value.id}`); refreshLibrary(value => value + 1) }) }}>另存到风格库</UiButton>
      {selectedPreset && <UiButton size="sm" disabled={busy} onClick={() => { void run(async signal => { const checked = await prepare(signal); guard(signal); videoEditStyleKitLibrary.update(selectedPreset.id, checked); refreshLibrary(value => value + 1) }) }}>更新个人风格</UiButton>}
      {selectedPreset && <UiButton size="sm" variant="danger" disabled={busy} onClick={() => { void run(signal => { guard(signal); videoEditStyleKitLibrary.remove(selectedPreset.id); setDraft(current ? structuredClone(current) : fresh(BUILTIN_STYLE_KITS[0])); setSelected(current ? `project:${current.id}` : `preset:${BUILTIN_STYLE_KITS[0].id}`); refreshLibrary(value => value + 1) }) }}>删除个人风格</UiButton>}
      {busy && <UiButton size="sm" onClick={() => abort.current?.abort()}>取消</UiButton>}
    </div>
    {STYLE_GUIDE_SECTIONS.map(spec => section(spec.title, spec.hint))}
    {extras.map(extra => section(extra.title, ''))}
    <UiGroup title="参考示例" titleTone="compact" divided>
      {draft.examples.length > 0 && <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`} onPointerEnter={() => setPreviewing(true)} onPointerLeave={() => setPreviewing(false)}>
        {visible && <VideoEditPresetPlayer source={previewSource} size={PREVIEW_SIZE} playing={previewing} label={`${draft.name}参考示例`} />}
      </span>}
      {draft.examples.map(example => <UiGroup key={example.id} labelWidth={72} divided>
        <UiFormRow label="标题" density="compact" trailing={<UiIconButton size="sm" tone="danger" label={`删除示例“${example.title}”`} disabled={busy} onClick={() => setDraft(previous => ({ ...previous, examples: previous.examples.filter(value => value.id !== example.id) }))}><Trash2 /></UiIconButton>}>
          <UiInput size="sm" aria-label="示例标题" value={example.title} onChange={event => editExample(example.id, { title: event.target.value })} />
        </UiFormRow>
        <UiFormRow label="演示了" density="compact" trailing={null}><UiTextArea aria-label="示例说明" placeholder="这段示例演示了说明书里的哪几条规矩" value={example.note} onChange={event => editExample(example.id, { note: event.target.value })} /></UiFormRow>
      </UiGroup>)}
      <UiButton size="sm" disabled={busy || !selectedCode} disabledReason="先在时间线上选择一个代码片段" onClick={() => { void run(signal => { guard(signal); setDraft(captureVideoEditStyleExample(projectId, sequence.id, draft)) }) }}>把所选代码片段加为示例</UiButton>
    </UiGroup>
  </UiGroup>
}
export function VideoEditStyleKitsPanel(props: Parameters<typeof Panel>[0]): React.ReactElement { return props.instance.activeSequenceId ? <Panel {...props} /> : <UiEmpty className="h-full" title="没有序列" /> }
