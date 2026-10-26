import { useCallback, useMemo, useRef, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { UiEmpty, UiFieldLayoutContext, UiFormRow, UiIconButton, UiOptionButton, UiSearchInput, UiSegmented, UI_TEXT_META_CLASS } from '@/components/ui'
import { DockHeaderPortal } from '@/components/dockLayouts/DockHeaderPortal'
import { EffectSection, EffectToggle } from '@/components/effects/EffectSection'
import { AudioEffectParams } from '@/components/audio/AudioEffectRack'
import { EssentialSoundControls, LoudnessMatchRows } from '@/components/audio/EssentialSoundControls'
import { ParamField, type ParamGesture } from '@/components/ui/params/ParamField'
import { ParamList } from '@/components/ui/params/ParamList'
import type { ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { UI_PROPERTY_INSET_CLASS, UI_TRIGGER_PANEL_CLASS } from '@/components/ui/styleTokens'
import { videoEditBuiltinDefaults, videoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import { audioEditEssentialItemSettings, type AudioEditChainItem, type AudioEditOutput } from '@/core/audioEdit/effects'
import { audioEditChainItemName, audioEditEffectCatalog, filterAudioEditEffectCatalog, AUDIO_EDIT_EFFECT_FOLDER_NAMES, type AudioEditEffectCatalogEntry } from '@/core/audioEdit/effectCatalog'
import type { AudioEditProcessorDescriptor } from '@/core/audioEdit/types'
import { beginAudioEditGesture } from '../application/audioEditProjectInstances'
import { matchProjectAudioEditLoudness } from '../application/audioEditApplicationService'
import { useAudioEditWorkspace, type AudioEditWorkspace } from './audioEditWorkspaceContext'
import { analyzeAudioEditEffect, AUDIO_EDIT_EFFECT_DRAG_TYPE, insertAudioEditEffect, useAudioEditEffectSelection } from './audioEditEffectInsert'

/**
 * 效果控件（2026-10-26 重构，对齐剪辑的效果控件）：一串有顺序的效果，从上到下依次处理录音本身；拖标题行改顺序，
 * 顺序就是处理顺序。顶部搜索直接加效果（加在选中项下面），也可以从“效果”面板双击或拖进来。最底下固定的“输出”
 * 作用在剪好的整条声音上（音量、自动匹配响度）。标签行放整体开关。
 */
export function AudioEditEffectControls(): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  const { project, update, disabled } = workspace
  const chain = useMemo(() => project.effectChain ?? [], [project.effectChain])
  const bypassed = project.chainBypassed === true
  const selection = useAudioEditEffectSelection()
  const selectedId = selection.projectId === project.id ? selection.selectedId : ''
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const catalog = useMemo(() => audioEditEffectCatalog(workspace.processors), [workspace.processors])
  const replace = useCallback((next: AudioEditChainItem): void => update({ effectChain: chain.map(item => item.id === next.id ? next : item) }), [chain, update])
  const remove = (item: AudioEditChainItem): void => {
    const index = chain.indexOf(item)
    update({ effectChain: chain.filter(candidate => candidate.id !== item.id) })
    selection.select(project.id, chain[index + 1]?.id ?? chain[index - 1]?.id ?? '')
  }
  const ids = useMemo(() => chain.map(item => item.id), [chain])
  const reorder = useCallback((from: number, to: number): void => {
    const next = chain.slice(); const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    update({ effectChain: next })
  }, [chain, update])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({ disabled, isCustomDragging: false, files: ids, layout: 'vertical', onReorder: reorder, dragBoundaryRef: list, dragThreshold: 4 })
  const toggleOpen = (id: string): void => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const dropAt = (event: React.DragEvent, index: number): void => {
    if (!event.dataTransfer.types.includes(AUDIO_EDIT_EFFECT_DRAG_TYPE)) return
    event.preventDefault(); event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
  }
  const drop = (event: React.DragEvent): void => {
    const key = event.dataTransfer.getData(AUDIO_EDIT_EFFECT_DRAG_TYPE)
    const entry = catalog.find(candidate => candidate.key === key)
    const at = dropIndex ?? chain.length
    setDropIndex(null)
    if (!entry) return
    event.preventDefault()
    insertAudioEditEffect(workspace, entry, at)
  }

  const tools = chain.length > 0 ? <EffectToggle size="sm" enabled={!bypassed} label={bypassed ? '启用全部效果' : '停用全部效果'}
    tooltip={bypassed ? '启用全部效果' : '停用全部效果，对比处理前后的声音（输出照常）'} disabled={disabled} onChange={enabled => update({ chainBypassed: !enabled })} /> : null
  return <div className="flex h-full min-h-0 flex-col bg-panel" data-audio-edit-panel="effects" tabIndex={-1}
    onKeyDown={event => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return
      const selected = chain.find(item => item.id === selectedId)
      if (selected && !disabled) { event.preventDefault(); remove(selected) }
    }}>
    <DockHeaderPortal panelId="audio_edit:effects" fallback={children => <div className="flex shrink-0 justify-end px-2 pt-1">{children}</div>}>{tools}</DockHeaderPortal>
    <div className="shrink-0 px-2 pb-1 pt-2"><EffectSearch catalog={catalog} disabled={disabled} onPick={entry => insertAudioEditEffect(workspace, entry)} /></div>
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto pb-3" aria-label="效果控件"
      onDragOver={event => { if (event.dataTransfer.types.includes(AUDIO_EDIT_EFFECT_DRAG_TYPE)) { event.preventDefault(); if (dropIndex === null) setDropIndex(chain.length) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null) }} onDrop={drop}>
      {chain.length === 0 && <UiEmpty size="node" title="还没有效果" description="在上面搜索，或从“效果”面板双击、拖进来；从上到下依次处理。" />}
      <div className={`flex flex-col ${bypassed ? 'opacity-50' : ''}`} role="list" aria-label="效果链">
        {chain.map((item, index) => {
          const name = audioEditChainItemName(item, workspace.processors)
          const open = !collapsed.has(item.id)
          const chosen = selectedId === item.id
          const reordering = (dragState.isDragging || dragState.isDropping) && dragState.toIndex === index && dragState.fromIndex !== index
          const insertion = reordering ? (dragState.fromIndex! < index ? 'bottom' : 'top') : dropIndex === index ? 'top' : dropIndex === index + 1 && index === chain.length - 1 ? 'bottom' : null
          return <div key={item.id} role="listitem" className="relative flex flex-col" data-audio-edit-effect={item.kind} onDragOver={event => dropAt(event, index)}>
            {insertion && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-raised h-0.5 bg-accent ${insertion === 'bottom' ? 'bottom-0' : 'top-0'}`} />}
            <EffectSection id={`audio-edit-effect:${item.id}`} title={name} open={open} onOpenChange={() => toggleOpen(item.id)} busy={disabled}
              collapseLabel={`${open ? '收起' : '展开'}效果${name}`}
              enabled={item.enabled} onEnabledChange={enabled => replace({ ...item, enabled })} toggleLabel={`${item.enabled ? '停用' : '启用'}效果${name}`} toggleTooltip={item.enabled ? '停用此效果（保留参数）' : '启用此效果'}
              actions={<>
                {resettable(item) && <UiIconButton size="2xs" aria-label={`重置效果${name}`} tooltip="恢复默认参数" disabled={disabled} onClick={() => replace(resetItem(item))}><RotateCcw /></UiIconButton>}
                <UiIconButton size="2xs" tone="danger" tooltip="删除效果" aria-label={`删除效果${name}`} disabled={disabled} onClick={event => { event.stopPropagation(); remove(item) }}><Trash2 /></UiIconButton>
              </>}
              headerRef={element => { itemRefs.current[index] = element }}
              headerProps={{ tabIndex: 0, role: 'group', 'aria-label': `效果${name}`, 'data-selected': chosen,
                className: `cursor-grab ${chosen ? 'bg-selected' : 'hover:bg-hover'} ${dragState.isDragging && dragState.fromIndex === index ? 'opacity-50' : ''}`,
                onMouseDown: event => { if ((event.target as HTMLElement).closest('button')) return; selection.select(project.id, item.id); event.currentTarget.focus(); handleMouseDown(index, event) },
                onClick: () => selection.select(project.id, item.id) }}>
              <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0"><EffectItemBody item={item} workspace={workspace} onChange={replace} /></fieldset>
            </EffectSection>
          </div>
        })}
      </div>
      <OutputSection output={project.output} />
    </div>
  </div>
}

/** 效果控件顶部的搜索：输入就列出匹配的效果，上下键挑、回车或点一下加到选中项下面。 */
function EffectSearch({ catalog, disabled, onPick }: { catalog: readonly AudioEditEffectCatalogEntry[]; disabled: boolean; onPick: (entry: AudioEditEffectCatalogEntry) => void }): React.ReactElement {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => query.trim() ? filterAudioEditEffectCatalog(catalog, query).filter(entry => !entry.disabledReason).slice(0, 12) : [], [catalog, query])
  const pick = (entry: AudioEditEffectCatalogEntry | undefined): void => { if (!entry) return; onPick(entry); setQuery(''); setActive(0) }
  return <div className="relative">
    <UiSearchInput size="sm" aria-label="搜索并添加效果" placeholder="搜索并添加效果" value={query} disabled={disabled} onClear={() => setQuery('')}
      onChange={event => { setQuery(event.target.value); setActive(0) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)) }
        else if (event.key === 'Enter') { event.preventDefault(); pick(results[active]) }
        else if (event.key === 'Escape') setQuery('')
      }} />
    {query.trim() && <div role="listbox" aria-label="匹配的效果" className={`${UI_TRIGGER_PANEL_CLASS} absolute inset-x-0 top-full z-dropdown mt-1 max-h-72 overflow-y-auto p-1`}>
      {results.length ? results.map((entry, index) => <UiOptionButton key={entry.key} role="option" aria-selected={index === active} variant="menu" size="sm" active={index === active} className="w-full" tooltip={entry.tooltip}
        onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => pick(entry)}>
        <span className="flex min-w-0 items-baseline gap-2"><span className="truncate">{entry.name}</span><span className="shrink-0 text-2xs text-text3">{entry.folder === 'builtin' ? entry.groupName : AUDIO_EDIT_EFFECT_FOLDER_NAMES[entry.folder]}</span></span>
      </UiOptionButton>) : <p className={`m-0 px-2 py-2 ${UI_TEXT_META_CLASS}`}>没有找到“{query.trim()}”相关的效果</p>}
    </div>}
  </div>
}

function resettable(item: AudioEditChainItem): boolean { return item.kind === 'builtin' || item.kind === 'separation' || item.kind === 'breath' || item.kind === 'plugin' }
function resetItem(item: AudioEditChainItem): AudioEditChainItem {
  if (item.kind === 'builtin') { const definition = videoEditBuiltinEffect(item.builtin.id); return definition ? { ...item, amount: 1, builtin: { ...item.builtin, params: videoEditBuiltinDefaults(definition) as typeof item.builtin.params } } : item }
  if (item.kind === 'separation') return { ...item, amount: 1 }
  if (item.kind === 'breath') return { ...item, mode: 'attenuate', reductionDb: -12 }
  if (item.kind === 'plugin') return { ...item, parameters: {} }
  return item
}

/** 一个数值参数的手势：连续拖动合成一步撤销，松手时 onCommit（检测类的参数在松手时重新检测）。 */
function useValueGesture(projectId: string, write: (value: number) => void, onCommit?: (value: number) => void): ParamGesture {
  const active = useRef<{ finish: () => void; cancel: () => void } | null>(null)
  const last = useRef<number | null>(null)
  return {
    begin: () => { if (!active.current) active.current = beginAudioEditGesture(projectId) },
    finish: () => { active.current?.finish(); active.current = null; if (last.current !== null) onCommit?.(last.current); last.current = null },
    cancel: () => { active.current?.cancel(); active.current = null; last.current = null },
    active: () => !!active.current,
    write: next => { last.current = Number(next); write(Number(next)) },
    atomic: next => { const handle = beginAudioEditGesture(projectId); write(Number(next)); handle.finish(); onCommit?.(Number(next)) },
  }
}

const slider = (key: string, title: string, tooltip: string, min: number, max: number, step: number, unit: string, value: number): ParamFieldSpec =>
  ({ source: 'builtin', bindingKeys: [key], key, title, tooltip, type: 'number', min, max, step, unit, control: 'slider', default: value, animatable: false }) as ParamFieldSpec

/** 一项效果展开后的参数（按种类）。 */
function EffectItemBody({ item, workspace, onChange }: { item: AudioEditChainItem; workspace: AudioEditWorkspace; onChange: (next: AudioEditChainItem) => void }): React.ReactElement {
  const projectId = workspace.project.id
  if (item.kind === 'builtin') return <AudioEffectParams effect={item} gesture={() => beginAudioEditGesture(projectId)} onChange={next => onChange({ ...next, kind: 'builtin' })} />
  if (item.kind === 'essential') return <EssentialSoundControls scope="chain" value={item.settings} disabled={workspace.disabled} gesture={() => beginAudioEditGesture(projectId)}
    onChange={next => { if (next) onChange({ ...item, settings: audioEditEssentialItemSettings(next) }) }} />
  if (item.kind === 'mouth_declick') return <MouthDeclickBody item={item} workspace={workspace} />
  if (item.kind === 'breath') return <BreathBody item={item} workspace={workspace} onChange={onChange} />
  if (item.kind === 'separation') return <SeparationBody item={item} projectId={projectId} onChange={onChange} />
  return <PluginBody item={item} plugin={workspace.processors.find(plugin => plugin.id === item.pluginId)} projectId={projectId} onChange={onChange} />
}

function Readout({ label, value }: { label: string; value: string }): React.ReactElement {
  return <UiFormRow label={label} density="compact"><span className="text-xs tabular-nums text-text1">{value}</span></UiFormRow>
}

function MouthDeclickBody({ item, workspace }: { item: Extract<AudioEditChainItem, { kind: 'mouth_declick' }>; workspace: AudioEditWorkspace }): React.ReactElement {
  const [sensitivity, setSensitivity] = useState(item.sensitivity)
  const gesture = useValueGesture(workspace.project.id, setSensitivity, value => analyzeAudioEditEffect(workspace, item, value))
  const field = slider('sensitivity', '灵敏度', '越高检出越多，也越容易把正常的辅音当成口水音；松手后按新灵敏度重新检测。', 0, 100, 5, '', 50)
  return <UiFieldLayoutContext.Provider value="property"><div className="flex flex-col">
    <ParamList fields={[field]} values={{ sensitivity }} renderControl={(spec, value) => <ParamField field={spec} value={value} gesture={gesture} />} />
    <Readout label="检测到" value={!item.analyzed ? '正在检测…' : item.clicks.length ? `${item.clicks.length} 处` : '没有找到'} />
  </div></UiFieldLayoutContext.Provider>
}

function BreathBody({ item, workspace, onChange }: { item: Extract<AudioEditChainItem, { kind: 'breath' }>; workspace: AudioEditWorkspace; onChange: (next: AudioEditChainItem) => void }): React.ReactElement {
  const latest = useRef(item); latest.current = item
  const gesture = useValueGesture(workspace.project.id, value => onChange({ ...latest.current, reductionDb: value }))
  const field = slider('reductionDb', '减弱', '每处呼吸统一压低多少分贝。', -40, 0, 1, 'dB', -12)
  return <UiFieldLayoutContext.Provider value="property"><div className="flex flex-col">
    <UiFormRow label="处理方式" info="减弱保留一点气口更自然；静音整段无声。两种都不改变时长，要删掉呼吸用文字稿里的“自动粗剪”。" density="compact">
      <UiSegmented ariaLabel="呼吸声处理方式" size="sm" fullWidth value={item.mode} options={[{ value: 'attenuate', label: '减弱' }, { value: 'mute', label: '静音' }]} onChange={mode => onChange({ ...item, mode })} />
    </UiFormRow>
    {item.mode === 'attenuate' && <ParamList fields={[field]} values={{ reductionDb: item.reductionDb }} renderControl={(spec, value) => <ParamField field={spec} value={value} gesture={gesture} />} />}
    <Readout label="检测到" value={!item.analyzed ? '正在检测…' : item.breaths.length ? `${item.breaths.length} 处` : '没有找到'} />
  </div></UiFieldLayoutContext.Provider>
}

function SeparationBody({ item, projectId, onChange }: { item: Extract<AudioEditChainItem, { kind: 'separation' }>; projectId: string; onChange: (next: AudioEditChainItem) => void }): React.ReactElement {
  const latest = useRef(item); latest.current = item
  const gesture = useValueGesture(projectId, value => onChange({ ...latest.current, amount: value / 100 }))
  const field = slider('amount', '量', '处理结果与原声混合的比例；100% 为完全处理。', 0, 100, 1, '%', 100)
  return <UiFieldLayoutContext.Provider value="property"><div className="flex flex-col">
    <ParamList fields={[field]} values={{ amount: Math.round(item.amount * 100) }} renderControl={(spec, value) => <ParamField field={spec} value={value} gesture={gesture} />} />
    <p className={`m-0 py-1 ${UI_TEXT_META_CLASS} ${UI_PROPERTY_INSET_CLASS}`}>用本地模型整段处理，改动后在后台重新处理；第一次使用会下载约 67 MB 的模型。</p>
  </div></UiFieldLayoutContext.Provider>
}

function PluginBody({ item, plugin, projectId, onChange }: { item: Extract<AudioEditChainItem, { kind: 'plugin' }>; plugin: AudioEditProcessorDescriptor | undefined; projectId: string; onChange: (next: AudioEditChainItem) => void }): React.ReactElement {
  const latest = useRef(item); latest.current = item
  const active = useRef<{ finish: () => void; cancel: () => void } | null>(null)
  if (!plugin?.available) return <p className={`m-0 py-1 ${UI_TEXT_META_CLASS} ${UI_PROPERTY_INSET_CLASS}`}>{plugin ? plugin.reason ?? '这个插件现在还不能加载。' : '这台电脑上找不到这个插件，处理时先跳过它；设置都保留，装好插件后会照常生效。'}</p>
  const parameters = plugin.parameters ?? []
  const fields = parameters.map(parameter => slider(`p${parameter.id}`, parameter.name, `${parameter.name}（插件参数，0–1）`, 0, 1, 0.01, '', parameter.normalizedValue))
  const values = Object.fromEntries(parameters.map(parameter => [`p${parameter.id}`, item.parameters[parameter.name] ?? parameter.normalizedValue]))
  const gestureFor = (name: string): ParamGesture => ({
    begin: () => { if (!active.current) active.current = beginAudioEditGesture(projectId) },
    finish: () => { active.current?.finish(); active.current = null }, cancel: () => { active.current?.cancel(); active.current = null }, active: () => !!active.current,
    write: next => onChange({ ...latest.current, parameters: { ...latest.current.parameters, [name]: Number(next) } }),
    atomic: next => { const handle = beginAudioEditGesture(projectId); onChange({ ...latest.current, parameters: { ...latest.current.parameters, [name]: Number(next) } }); handle.finish() },
  })
  return <UiFieldLayoutContext.Provider value="property"><div className="flex flex-col">
    {fields.length > 0 && <ParamList fields={fields} values={values} renderControl={(spec, value) => <ParamField field={spec} value={value} gesture={gestureFor(parameters.find(parameter => `p${parameter.id}` === spec.key)!.name)} />} />}
    <p className={`m-0 py-1 ${UI_TEXT_META_CLASS} ${UI_PROPERTY_INSET_CLASS}`}>{plugin.vendor} · 插件整段处理，改动后在后台重新处理。</p>
  </div></UiFieldLayoutContext.Provider>
}

/** 输出：作用在剪好的整条声音上（所有效果之后）。 */
function OutputSection({ output }: { output: AudioEditOutput | undefined }): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  const { project, update } = workspace
  const current: AudioEditOutput = output ?? { volumeDb: 0 }
  const latest = useRef(current); latest.current = current
  const [matching, setMatching] = useState(false)
  const [measured, setMeasured] = useState<{ projectId: string; lufs: number } | null>(null)
  const gesture = useValueGesture(project.id, value => update({ output: { ...latest.current, volumeDb: value } }))
  const match = (targetLufs: number) => void workspace.run(async () => {
    setMatching(true)
    try { setMeasured({ projectId: project.id, lufs: (await matchProjectAudioEditLoudness(project.id, targetLufs)).integratedLufs }) } finally { setMatching(false) }
  })
  return <EffectSection id="audio-edit-output" title="输出" info="作用在剪好的整条声音上，在全部效果之后：音量与自动匹配响度。">
    <UiFieldLayoutContext.Provider value="property"><fieldset disabled={workspace.disabled} className="m-0 flex min-w-0 flex-col border-0 p-0">
      <ParamList fields={[slider('volumeDb', '音量', '整条声音的音量。', -24, 24, 0.5, 'dB', 0)]} values={{ volumeDb: current.volumeDb }} renderControl={(spec, value) => <ParamField field={spec} value={value} gesture={gesture} />} />
      <LoudnessMatchRows loudness={current.loudness ?? { enabled: false, targetLufs: -16, gainDb: 0 }} disabled={workspace.disabled} matching={matching} onMatch={match}
        {...(measured?.projectId === project.id ? { measuredLufs: measured.lufs } : {})} onChange={loudness => update({ output: { ...latest.current, loudness } })} />
    </fieldset></UiFieldLayoutContext.Provider>
  </EffectSection>
}
