import { memo, useLayoutEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, RotateCcw, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiLoading, UiOptionButton, UiSwitch } from '@/components/ui'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { copyVideoEditEffects, createVideoEditEffect, deleteVideoEditEffects, listVideoEditFilterDefinitions, reorderVideoEditEffects, resetVideoEditEffect, updateVideoEditAdjustmentRange, updateVideoEditEffect } from '../application/videoEditCompositing'
import { requireVideoEditInstance, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditCodeCreateDialog } from './VideoEditCodeCreateDialog'
import { useVideoEditCompositeAction } from './useVideoEditCompositeAction'
type CompositeAction = ReturnType<typeof useVideoEditCompositeAction>
interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; onError: (reason: unknown) => void }

function EffectStrength({ effect, action, target, owner }: { effect: VideoEditEffect; action: CompositeAction; target: { projectId: string; sequenceId: string; clipId: string }; owner: VideoEditInstance }): React.ReactElement {
  const [draft, setDraft] = useState(String(effect.amount))
  useLayoutEffect(() => setDraft(String(effect.amount)), [effect.amount, effect.code.versionId, owner])
  const amount = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1
  return <UiFormRow label="效果强度" info="0 到 1；确认后检查画面并应用。"><div className="flex items-center gap-2"><UiInput aria-label="效果强度" type="number" min={0} max={1} step={0.05} value={draft} disabled={action.busy} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(String(effect.amount)) } }} /><UiButton variant="ghost" size="sm" disabled={action.busy || !valid || amount === effect.amount} onClick={() => { void action.run(signal => updateVideoEditEffect(target, effect.id, { amount }, signal)) }}>应用强度</UiButton></div></UiFormRow>
}

function AdjustmentRange({ target, sequence, clip, action }: { target: { projectId: string; sequenceId: string; clipId: string }; sequence: VideoEditSequence; clip: VideoEditClip; action: CompositeAction }): React.ReactElement {
  const options = useMemo(() => sequence.tracks.filter(track => track.kind === 'video' && track.index < clip.track).sort((a, b) => a.index - b.index).map(track => ({ value: track.index, label: track.name })), [sequence.tracks, clip.track])
  return <UiGroup title="调整作用范围" divided data-video-edit-adjustment-range={clip.id}><UiFormRow label="从画面轨道" info="处理此轨道及其上方、调整图层下方的画面。"><Dropdown<number> ariaLabel="调整图层起始画面轨道" value={clip.adjustment?.fromTrack} options={options} disabled={action.busy || !options.length} onSelect={fromTrack => { if (fromTrack !== clip.adjustment?.fromTrack) void action.run(signal => updateVideoEditAdjustmentRange(target, fromTrack, signal)) }} /></UiFormRow>{!options.length && <UiError size="xs" message="此调整图层下方没有可处理的画面轨道。" />}</UiGroup>
}

export const VideoEditEffectChainPanel = memo(function VideoEditEffectChainPanel({ instance, sequence, clip, onError }: Props): React.ReactElement {
  const document = instance.document
  const projectId = document.id; const sequenceId = sequence.id; const clipId = clip.id
  const target = { projectId, sequenceId, clipId }
  const action = useVideoEditCompositeAction(instance, JSON.stringify([projectId, sequenceId, clipId]), onError)
  const effects = clip.effects ?? []
  const [selectedId, setSelectedId] = useState(effects[0]?.id ?? '')
  const [definitionId, setDefinitionId] = useState('')
  const [copySource, setCopySource] = useState('')
  const [creatingFilter, setCreatingFilter] = useState(false)
  const [createdFilter, setCreatedFilter] = useState(false)
  const selected = effects.find(effect => effect.id === selectedId) ?? effects[0]
  const selectedIndex = selected ? effects.findIndex(effect => effect.id === selected.id) : -1
  const definitions = useMemo(() => {
    try {
      const items = listVideoEditFilterDefinitions(document.id)
      return { items, options: items.map(value => ({ value: value.id, label: value.name })), error: undefined }
    } catch (error) { return { items: [], options: [], error } }
  }, [document])
  const definition = useMemo(() => definitions.items.find(value => value.id === definitionId) ?? definitions.items[0], [definitions.items, definitionId])
  const sources = useMemo(() => document.sequences.flatMap(sourceSequence => sourceSequence.clips.filter(sourceClip => sourceClip.kind !== 'audio' && !!sourceClip.effects?.length && (sourceSequence.id !== sequenceId || sourceClip.id !== clipId)).map(sourceClip => ({ value: JSON.stringify([sourceSequence.id, sourceClip.id]), label: `${sourceSequence.name} · ${sourceClip.name}`, sequenceId: sourceSequence.id, clipId: sourceClip.id }))), [document, sequenceId, clipId])
  const source = useMemo(() => sources.find(value => value.value === copySource), [sources, copySource])
  useLayoutEffect(() => { setSelectedId(''); setDefinitionId(''); setCopySource(''); setCreatingFilter(false); setCreatedFilter(false) }, [instance])
  const move = (offset: -1 | 1): void => {
    const next = selectedIndex + offset
    if (!selected || next < 0 || next >= effects.length) return
    const ids = effects.map(effect => effect.id); const previous = ids[selectedIndex]
    ids[selectedIndex] = ids[next]; ids[next] = previous
    void action.run(signal => reorderVideoEditEffects(target, ids, signal))
  }
  return <>
    {clip.kind === 'adjustment' && <AdjustmentRange target={target} sequence={sequence} clip={clip} action={action} />}
    <UiGroup title="附加效果" divided data-video-edit-effect-chain={clipId} actions={<UiButton variant="plain" size="sm" disabled={action.busy} onClick={() => setCreatingFilter(true)}>编写新滤镜源码</UiButton>}>
      <UiFormRow label="工程滤镜"><div className="flex items-center gap-2"><Dropdown ariaLabel="选择工程滤镜" value={definition?.id} display={definitions.items.length ? undefined : '暂无滤镜源码'} options={definitions.options} disabled={action.busy || !definitions.items.length} onSelect={setDefinitionId} /><UiButton variant="ghost" size="sm" disabled={action.busy || !definition || effects.length >= 4} onClick={() => { if (definition) void action.run(signal => createVideoEditEffect(target, { definitionId: definition.id, versionId: definition.versionId }, signal), setSelectedId) }}>添加到片段</UiButton></div></UiFormRow>
      {createdFilter && <p className="text-2xs text-text-muted">滤镜源码已创建，选择“添加到片段”检查并应用。</p>}
      {definitions.error ? <UiError size="xs" message={definitions.error instanceof Error ? definitions.error.message : '工程滤镜暂不可用。'} /> : null}
      {effects.length ? <><p className="text-2xs text-text-muted">从上到下依次执行，最多添加四项。</p><div className="flex flex-col gap-1">{effects.map(effect => <UiOptionButton key={effect.id} variant="menu" className="w-full min-w-0 justify-between gap-2 text-xs" active={selected?.id === effect.id} disabled={action.busy} aria-label={`选择效果${effect.name}`} aria-pressed={selected?.id === effect.id} data-video-edit-effect={effect.id} onClick={() => setSelectedId(effect.id)}><span className="truncate">{effect.name}</span><span className="shrink-0 text-2xs text-text-muted">{effect.enabled ? '启用' : '关闭'}</span></UiOptionButton>)}</div></> : <UiEmpty title="尚未添加效果" description="选择工程滤镜，或编写新的滤镜源码。" />}
      {selected && <>
        <UiFormRow label="启用效果" inline><UiSwitch aria-label="启用所选效果" checked={selected.enabled} disabled={action.busy} onCheckedChange={enabled => { void action.run(signal => updateVideoEditEffect(target, selected.id, { enabled }, signal)) }} /></UiFormRow>
        <EffectStrength key={selected.id} effect={selected} action={action} target={target} owner={instance} />
        <div className="flex items-center gap-1">
          <UiIconButton appearance="hover-only" title="提前执行" aria-label="上移效果" disabled={action.busy || selectedIndex <= 0} onClick={() => move(-1)}><ArrowUp size={16} /></UiIconButton>
          <UiIconButton appearance="hover-only" title="稍后执行" aria-label="下移效果" disabled={action.busy || selectedIndex >= effects.length - 1} onClick={() => move(1)}><ArrowDown size={16} /></UiIconButton>
          <UiIconButton appearance="hover-only" title="恢复默认参数、强度和开关，并移除此效果关键帧" aria-label="重置效果与关键帧" disabled={action.busy} onClick={() => { void action.run(signal => resetVideoEditEffect(target, selected.id, signal)) }}><RotateCcw size={16} /></UiIconButton>
          <UiIconButton appearance="hover-only" title="删除效果" aria-label="删除所选效果" disabled={action.busy} onClick={() => { void action.run(signal => deleteVideoEditEffects(target, [selected.id], signal), () => setSelectedId(effects[selectedIndex + 1]?.id ?? effects[selectedIndex - 1]?.id ?? '')) }}><Trash2 size={16} /></UiIconButton>
        </div>
      </>}
      {sources.length > 0 && <><UiFormRow label="复制来源"><Dropdown ariaLabel="复制效果的来源片段" value={source?.value} display={source ? undefined : '选择来源片段'} options={sources} disabled={action.busy} onSelect={setCopySource} /></UiFormRow><p className="text-2xs text-text-muted">复制来源片段的整条效果链及关键帧，替换当前片段已有的附加效果。</p><UiButton variant="ghost" size="sm" disabled={action.busy || !source} onClick={() => { if (source) void action.run(signal => copyVideoEditEffects(target, { sequenceId: source.sequenceId, clipId: source.clipId }, signal), () => setSelectedId('')) }}>复制并替换当前效果链</UiButton></>}
      {action.busy && <div className="flex items-center gap-2"><UiLoading size="xs" message="正在检查混合画面" /><UiButton variant="plain" size="sm" onClick={action.cancel}>取消检查</UiButton></div>}
    </UiGroup>
    {selected && !action.busy && <div data-video-edit-effect-editor={selected.id}><CodeParameterPanel key={JSON.stringify([projectId, sequenceId, clipId, selected.id, selected.code.versionId])} projectId={projectId} sequenceId={sequenceId} clipId={clipId} effectId={selected.id} onError={onError} /></div>}
    {creatingFilter && <VideoEditCodeCreateDialog projectId={projectId} mode="filter" onClose={() => setCreatingFilter(false)} onCreated={ids => { if (requireVideoEditInstance(projectId) === instance) { setDefinitionId(ids[0] ?? ''); setCreatedFilter(true) } }} />}
  </>
})
