import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { ICON_ASSET_CODE, UI_ICON_SIZE } from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { Dropdown, PanelTrigger, UiButton, UiError, UiFormRow, UiIconButton, UiLoading, UiOptionButton, UiToolbar } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { isVideoEditBuiltinEffect, type VideoEditEffect } from '@/core/videoEdit/compositing'
import { copyVideoEditEffects, createVideoEditEffect, deleteVideoEditEffects, listVideoEditFilterDefinitions, reorderVideoEditEffects, resetVideoEditEffect, updateVideoEditAdjustmentRange, updateVideoEditBuiltinEffect, updateVideoEditEffect } from '../application/videoEditCompositing'
import { requireVideoEditInstance, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditCodeCreateDialog } from './VideoEditCodeCreateDialog'
import { useVideoEditCompositeAction } from './useVideoEditCompositeAction'
import { VideoEditEffectSection, VideoEditEffectToggle } from './VideoEditEffectSection'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditKeyboardCommand } from '../application/videoEditKeyboard'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { VideoEditBuiltinEffectControls } from './VideoEditBuiltinEffectControls'
import { VideoEditEffectPresetDialog } from './VideoEditEffectPresetDialog'
import { isRecordingClipEffect, recordingClipSource } from '../application/videoEditRecordingClip'
type CompositeAction = ReturnType<typeof useVideoEditCompositeAction>
interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; footer: HTMLElement | null; onError: (reason: unknown) => void }

function EffectStrength({ effect, action, target, owner }: { effect: VideoEditEffect; action: CompositeAction; target: { projectId: string; sequenceId: string; clipId: string }; owner: VideoEditInstance }): React.ReactElement {
  const [draft, setDraft] = useState(String(effect.amount))
  useLayoutEffect(() => setDraft(String(effect.amount)), [effect.amount, effect.code?.versionId, owner])
  const amount = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1
  return <UiFormRow label="效果强度" info="与原画面混合的比例，0 到 1。"><div className="flex items-center gap-1" onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(String(effect.amount)) } }}>
    {amount !== effect.amount && <UiButton size="sm" variant="secondary" className="shrink-0" disabled={action.busy || !valid} onClick={() => { void action.run(signal => updateVideoEditEffect(target, effect.id, { amount }, signal), undefined, false) }}>应用强度</UiButton>}
    <NumberInput ariaLabel="效果强度" size="sm" min={0} max={1} step={0.05} precision={4} align="right" value={Number.isFinite(amount) ? amount : effect.amount} disabled={action.busy} commitOnChange onChange={next => setDraft(String(next))} />
  </div></UiFormRow>
}

function AdjustmentRange({ target, sequence, clip, action }: { target: { projectId: string; sequenceId: string; clipId: string }; sequence: VideoEditSequence; clip: VideoEditClip; action: CompositeAction }): React.ReactElement {
  const options = useMemo(() => sequence.tracks.filter(track => track.kind === 'video' && track.index < clip.track).sort((a, b) => a.index - b.index).map(track => ({ value: track.index, label: track.name })), [sequence.tracks, clip.track])
  return <VideoEditEffectSection id="adjustment-range" title="调整作用范围"><div data-video-edit-adjustment-range={clip.id}>
    <UiFormRow label="从画面轨道" info="处理此轨道及其上方、调整图层下方的画面。"><Dropdown<number> ariaLabel="调整图层起始画面轨道" value={clip.adjustment?.fromTrack} options={options} disabled={action.busy || !options.length} onSelect={fromTrack => { if (fromTrack !== clip.adjustment?.fromTrack) void action.run(signal => updateVideoEditAdjustmentRange(target, fromTrack, signal), undefined, false) }} /></UiFormRow>
    {!options.length && <div className={UI_PROPERTY_INSET_CLASS}><UiError size="xs" title="此调整图层下方没有可处理的画面轨道" message="" /></div>}
  </div></VideoEditEffectSection>
}

/**
 * 附加效果（重要记录 019，对齐 AE）：不再有“附加效果”大标题，每个效果直接是一节——箭头折叠、fx 开关、名称，悬停出重置与删除；
 * 点标题行选中（Delete 删除），拖标题行换序。添加、从其他片段复制、保存预设与全部效果的总开关在面板右下角的底栏。
 */
export const VideoEditEffectChainPanel = memo(function VideoEditEffectChainPanel({ instance, sequence, clip, footer, onError }: Props): React.ReactElement {
  const document = instance.document
  const projectId = document.id; const sequenceId = sequence.id; const clipId = clip.id
  const target = { projectId, sequenceId, clipId }
  const action = useVideoEditCompositeAction(instance, JSON.stringify([projectId, sequenceId, clipId]), onError)
  // A recording clip's pointer, zoom and frame live in the recording panel above; listing them here too would give one setting two places.
  const recording = useMemo(() => Boolean(recordingClipSource(document, clip)), [document, clip])
  const effects = useMemo(() => (clip.effects ?? []).filter(effect => !recording || !isRecordingClipEffect(effect)), [clip.effects, recording])
  const fixed = useMemo(() => (clip.effects ?? []).filter(effect => recording && isRecordingClipEffect(effect)).map(effect => effect.id), [clip.effects, recording])
  /** 声音片段的效果链只放音频内置效果（4.7c），没有代码滤镜。 */
  const sound = clip.kind === 'audio'
  const effectsLabel = sound ? '音频效果' : '附加效果'
  const [selectedId, setSelectedId] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const chain = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const [creatingFilter, setCreatingFilter] = useState(false)
  const [createdFilter, setCreatedFilter] = useState(false)
  const [savingPreset, setSavingPreset] = useState<VideoEditEffect[] | null>(null)
  const savableEffects = effects.filter(isVideoEditBuiltinEffect)
  const selected = effects.find(effect => effect.id === selectedId)
  const [definitions, setDefinitions] = useState<{ items: Array<{ id: string; name: string; versionId: string }>; error?: unknown; loading?: boolean }>({ items: [] })
  useEffect(() => {
    let current = true
    setDefinitions({ items: [], loading: true })
    void listVideoEditFilterDefinitions(document.id).then(items => {
      if (current) setDefinitions({ items })
    }, error => { if (current) setDefinitions({ items: [], error }) })
    return () => { current = false }
  }, [document.id, document.codeMaterials])
  const sources = useMemo(() => document.sequences.flatMap(sourceSequence => sourceSequence.clips.filter(sourceClip => (sourceClip.kind === 'audio') === sound && !!sourceClip.effects?.length && (sourceSequence.id !== sequenceId || sourceClip.id !== clipId)).map(sourceClip => ({ value: JSON.stringify([sourceSequence.id, sourceClip.id]), label: `${sourceSequence.name} · ${sourceClip.name}`, sequenceId: sourceSequence.id, clipId: sourceClip.id }))), [document, sequenceId, clipId, sound])
  useLayoutEffect(() => { setSelectedId(''); setCollapsed(new Set()); setCreatingFilter(false); setCreatedFilter(false); setSavingPreset(null) }, [instance, sequenceId, clipId])
  const ids = useMemo(() => effects.map(effect => effect.id), [effects])
  const reorder = useCallback((from: number, to: number): void => {
    const order = ids.slice(); const [moved] = order.splice(from, 1); order.splice(to, 0, moved)
    void action.run(signal => reorderVideoEditEffects({ projectId, sequenceId, clipId }, [...fixed, ...order], signal), undefined, false)
  }, [ids, fixed, action, projectId, sequenceId, clipId])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({ disabled: action.busy, isCustomDragging: false, files: ids, layout: 'vertical', onReorder: reorder, dragBoundaryRef: chain, dragThreshold: 4 })
  const toggle = (id: string): void => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const panel = (): HTMLElement | null | undefined => root.current?.closest<HTMLElement>('[data-video-edit-panel="effects"]')
  const remove = (effect: VideoEditEffect): void => {
    const index = effects.indexOf(effect)
    void action.run(signal => deleteVideoEditEffects(target, [effect.id], signal), () => { setSelectedId(effects[index + 1]?.id ?? effects[index - 1]?.id ?? ''); panel()?.focus() }, false)
  }
  // 内置效果是确定的 GPU 实现：开关与重置直接一步撤销，不必像代码滤镜那样先试渲染检查。
  const setEnabled = (effect: VideoEditEffect, enabled: boolean): void => {
    if (effect.builtin) { try { updateVideoEditBuiltinEffect(target, effect.id, { enabled }) } catch (error) { onError(error) } }
    else void action.run(signal => updateVideoEditEffect(target, effect.id, { enabled }, signal), undefined, false)
  }
  const reset = (effect: VideoEditEffect): void => { void action.run(signal => resetVideoEditEffect(target, effect.id, signal), undefined, !effect.builtin) }
  const master = clip.effectsEnabled !== false
  const setMaster = (enabled: boolean): void => { try { updateVideoEditClipProperties(projectId, sequenceId, clipId, { effectsEnabled: enabled }) } catch (error) { onError(error) } }
  useEffect(() => {
    const host = panel()
    if (!host) return
    const keydown = (event: KeyboardEvent): void => {
      const binding = videoEditKeyboardCommand(event, 'effects', shortcuts)
      if (binding?.id !== 'delete_effect') return
      event.preventDefault(); event.stopPropagation()
      if (selected && !action.busy && !dragState.isDragging && !dragState.isDropping) remove(selected)
    }
    host.addEventListener('keydown', keydown)
    return () => host.removeEventListener('keydown', keydown)
  })
  const CodeIcon = ICON_ASSET_CODE
  const menuItem = 'gap-2'
  const tools = <>
    {!sound && <PanelTrigger panelSize="menu" zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" alignment="bottomRight" renderPanel={() => <div className="flex flex-col gap-1" role="menu" aria-label="添加效果">
      {definitions.loading && <UiLoading size="xs" message="正在读取代码效果…" />}
      {definitions.error ? <UiError size="xs" message={definitions.error instanceof Error ? definitions.error.message : '剪辑滤镜暂不可用。'} /> : null}
      {definitions.items.map(definition => <UiOptionButton key={definition.id} role="menuitem" variant="menu" size="sm" disabled={action.busy} onClick={() => { void action.run(signal => createVideoEditEffect(target, { definitionId: definition.id, versionId: definition.versionId }, signal), setSelectedId) }}>{definition.name}</UiOptionButton>)}
      <UiOptionButton role="menuitem" variant="menu" size="sm" className={menuItem} disabled={action.busy} onClick={() => setCreatingFilter(true)}><CodeIcon size={UI_ICON_SIZE.sm} />编写新滤镜源码</UiOptionButton>
    </div>}>
      {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="添加效果" tooltip="添加代码滤镜；内置效果从“效果”面板拖到片段上" aria-expanded={open} disabled={action.busy} data-panel-trigger-button onClick={togglePanel}><Plus /></UiIconButton>}
    </PanelTrigger>}
    {sources.length > 0 && <PanelTrigger panelSize="menu" zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" alignment="bottomRight" renderPanel={() => <div className="flex flex-col gap-1" role="menu" aria-label="复制其他片段的效果">
      {sources.map(source => <UiOptionButton key={source.value} role="menuitem" variant="menu" size="sm" disabled={action.busy} onClick={() => { void action.run(signal => copyVideoEditEffects(target, { sequenceId: source.sequenceId, clipId: source.clipId }, signal), () => setSelectedId(''), false) }}>{source.label}</UiOptionButton>)}
    </div>}>
      {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="复制其他片段的效果" tooltip={`复制另一个片段的整条效果链（连同关键帧），替换这里已有的${effectsLabel}`} aria-expanded={open} disabled={action.busy} data-panel-trigger-button onClick={togglePanel}><Copy /></UiIconButton>}
    </PanelTrigger>}
    <UiIconButton size="sm" aria-label="保存为预设" tooltip="保存为预设" disabled={action.busy || !savableEffects.length} onClick={() => setSavingPreset(structuredClone(savableEffects))}><Save /></UiIconButton>
    {effects.length > 0 && <VideoEditEffectToggle size="sm" enabled={master} label={`${master ? '停用' : '启用'}所有${effectsLabel}`} tooltip={master ? `停用所有${effectsLabel}（保留参数与关键帧）` : `启用所有${effectsLabel}`} onChange={setMaster} />}
  </>
  return <div ref={root}>
    {clip.kind === 'adjustment' && <AdjustmentRange target={target} sequence={sequence} clip={clip} action={action} />}
    <div ref={chain} className={master ? 'flex flex-col' : 'flex flex-col opacity-50'} data-video-edit-effect-chain={clipId} tabIndex={-1}>
      {effects.map((effect, index) => {
        const open = !collapsed.has(effect.id)
        const insertion = (dragState.isDragging || dragState.isDropping) && dragState.toIndex === index && dragState.fromIndex !== index
        const chosen = selectedId === effect.id
        return <div key={effect.id} className="relative flex flex-col" data-video-edit-effect={effect.id}>
          {insertion && <span data-video-edit-effect-insertion aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-raised h-0.5 bg-accent ${dragState.fromIndex! < index ? 'bottom-0' : 'top-0'}`} />}
          <VideoEditEffectSection id={`effect:${effect.id}`} title={effect.name} open={open} onOpenChange={() => toggle(effect.id)} busy={action.busy}
            collapseLabel={`${open ? '收起' : '展开'}效果${effect.name}`}
            enabled={effect.enabled} onEnabledChange={enabled => setEnabled(effect, enabled)} toggleLabel={`${effect.enabled ? '停用' : '启用'}效果${effect.name}`} toggleTooltip={effect.enabled ? '停用此效果（保留参数）' : '启用此效果'}
            actions={<>
              <UiIconButton size="2xs" aria-label={`重置效果${effect.name}`} tooltip="恢复默认参数、强度和开关，并移除此效果关键帧" disabled={action.busy} onClick={() => reset(effect)}><RotateCcw /></UiIconButton>
              <UiIconButton size="2xs" tone="danger" tooltip="删除效果" aria-label={`删除效果${effect.name}`} disabled={action.busy} onClick={event => { event.stopPropagation(); remove(effect) }}><Trash2 /></UiIconButton>
            </>}
            headerRef={element => { itemRefs.current[index] = element }}
            headerProps={{ tabIndex: 0, role: 'group', 'aria-label': `效果${effect.name}`, 'data-selected': chosen,
              className: `cursor-grab ${chosen ? 'bg-selected' : 'hover:bg-hover'} ${dragState.isDragging && dragState.fromIndex === index ? 'opacity-50' : ''}`,
              onMouseDown: event => { if ((event.target as HTMLElement).closest('button')) return; setSelectedId(effect.id); event.currentTarget.focus(); handleMouseDown(index, event) },
              onClick: () => { setSelectedId(effect.id); itemRefs.current[index]?.focus() } }}>
            <div className="flex flex-col" data-video-edit-effect-editor={effect.id}>
              {isVideoEditBuiltinEffect(effect) ? <VideoEditBuiltinEffectControls target={target} effect={effect} onError={onError} /> : <>
                {!action.busy && <CodeParameterPanel key={JSON.stringify([projectId, sequenceId, clipId, effect.id, effect.code?.versionId])} projectId={projectId} sequenceId={sequenceId} clipId={clipId} effectId={effect.id} onError={onError} />}
                <EffectStrength key={effect.id} effect={effect} action={action} target={target} owner={instance} />
              </>}
            </div>
          </VideoEditEffectSection>
        </div>
      })}
    </div>
    {createdFilter && <p className={`py-1 text-2xs text-text3 ${UI_PROPERTY_INSET_CLASS}`}>滤镜源码已创建，从底栏的“添加效果”加到片段。</p>}
    {action.busy && <div className={`flex items-center gap-2 py-1 ${UI_PROPERTY_INSET_CLASS}`}><UiLoading size="xs" message="正在检查混合画面" /><UiButton size="sm" onClick={action.cancel}>取消检查</UiButton></div>}
    {footer && createPortal(<UiToolbar variant="footer" aria-label={`${effectsLabel}工具`} trailing={tools}>{effects.length ? `${effects.length} 个${effectsLabel}` : `没有${effectsLabel}`}</UiToolbar>, footer)}
    {creatingFilter && <VideoEditCodeCreateDialog projectId={projectId} mode="filter" onClose={() => setCreatingFilter(false)} onCreated={() => { if (requireVideoEditInstance(projectId) === instance) setCreatedFilter(true) }} />}
    {savingPreset && <VideoEditEffectPresetDialog effects={savingPreset} initialName={savingPreset.length === 1 ? savingPreset[0].name : `${clip.name}效果`} onClose={() => setSavingPreset(null)} />}
  </div>
})
