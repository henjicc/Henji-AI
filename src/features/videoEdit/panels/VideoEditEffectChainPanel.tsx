import { memo, useLayoutEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Power, RotateCcw, Trash2 } from 'lucide-react'
import { ICON_ASSET_CODE } from '@/core/theme/icons'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiLoading, UiOptionButton, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { isVideoEditBuiltinEffect, VIDEO_EDIT_MAX_EFFECTS, type VideoEditEffect } from '@/core/videoEdit/compositing'
import { copyVideoEditEffects, createVideoEditEffect, deleteVideoEditEffects, listVideoEditFilterDefinitions, reorderVideoEditEffects, resetVideoEditEffect, updateVideoEditAdjustmentRange, updateVideoEditBuiltinEffect, updateVideoEditEffect } from '../application/videoEditCompositing'
import { requireVideoEditInstance, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditCodeCreateDialog } from './VideoEditCodeCreateDialog'
import { useVideoEditCompositeAction } from './useVideoEditCompositeAction'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import { VideoEditBuiltinEffectControls } from './VideoEditBuiltinEffectControls'
type CompositeAction = ReturnType<typeof useVideoEditCompositeAction>
interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; onError: (reason: unknown) => void }

function EffectStrength({ effect, action, target, owner }: { effect: VideoEditEffect; action: CompositeAction; target: { projectId: string; sequenceId: string; clipId: string }; owner: VideoEditInstance }): React.ReactElement {
  const [draft, setDraft] = useState(String(effect.amount))
  useLayoutEffect(() => setDraft(String(effect.amount)), [effect.amount, effect.code?.versionId, owner])
  const amount = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1
  return <UiFormRow density="compact" label="效果强度" info="0 到 1；确认后检查画面并应用。"><div className="flex flex-wrap items-center gap-2" onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(String(effect.amount)) } }}><NumberInput ariaLabel="效果强度" size="sm" min={0} max={1} step={0.05} precision={4} value={Number.isFinite(amount) ? amount : effect.amount} disabled={action.busy} commitOnChange onChange={next => setDraft(String(next))} /><UiButton variant="secondary" className="shrink-0" disabled={action.busy || !valid || amount === effect.amount} onClick={() => { void action.run(signal => updateVideoEditEffect(target, effect.id, { amount }, signal)) }}>应用强度</UiButton></div></UiFormRow>
}

function AdjustmentRange({ target, sequence, clip, action }: { target: { projectId: string; sequenceId: string; clipId: string }; sequence: VideoEditSequence; clip: VideoEditClip; action: CompositeAction }): React.ReactElement {
  const options = useMemo(() => sequence.tracks.filter(track => track.kind === 'video' && track.index < clip.track).sort((a, b) => a.index - b.index).map(track => ({ value: track.index, label: track.name })), [sequence.tracks, clip.track])
  return <UiGroup title="调整作用范围" titleTone="compact" divided data-video-edit-adjustment-range={clip.id}><UiFormRow density="compact" label="从画面轨道" info="处理此轨道及其上方、调整图层下方的画面。"><Dropdown<number> ariaLabel="调整图层起始画面轨道" value={clip.adjustment?.fromTrack} options={options} disabled={action.busy || !options.length} onSelect={fromTrack => { if (fromTrack !== clip.adjustment?.fromTrack) void action.run(signal => updateVideoEditAdjustmentRange(target, fromTrack, signal)) }} /></UiFormRow>{!options.length && <UiError size="xs" title="此调整图层下方没有可处理的画面轨道" message="" />}</UiGroup>
}

export const VideoEditEffectChainPanel = memo(function VideoEditEffectChainPanel({ instance, sequence, clip, onError }: Props): React.ReactElement {
  const document = instance.document
  const projectId = document.id; const sequenceId = sequence.id; const clipId = clip.id
  const target = { projectId, sequenceId, clipId }
  const action = useVideoEditCompositeAction(instance, JSON.stringify([projectId, sequenceId, clipId]), onError)
  const effects = clip.effects ?? []
  /** 展开的效果（同一时间只展开一项，参数编辑器只挂一份）；空串表示全部收起。 */
  const [selectedId, setSelectedId] = useState('')
  const [definitionId, setDefinitionId] = useState('')
  const [copySource, setCopySource] = useState('')
  const [creatingFilter, setCreatingFilter] = useState(false)
  const [createdFilter, setCreatedFilter] = useState(false)
  const selected = effects.find(effect => effect.id === selectedId)
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
  const toggle = (id: string): void => setSelectedId(selected?.id === id ? '' : id)
  // 内置效果是确定的 GPU 实现：开关与重置直接一步撤销，不必像代码滤镜那样先试渲染检查。
  const setEnabled = (effect: VideoEditEffect, enabled: boolean): void => {
    if (effect.builtin) { try { updateVideoEditBuiltinEffect(target, effect.id, { enabled }) } catch (error) { onError(error) } }
    else void action.run(signal => updateVideoEditEffect(target, effect.id, { enabled }, signal))
  }
  const reset = (effect: VideoEditEffect): void => { void action.run(signal => resetVideoEditEffect(target, effect.id, signal)) }
  const CodeIcon = ICON_ASSET_CODE
  return <>
    {clip.kind === 'adjustment' && <AdjustmentRange target={target} sequence={sequence} clip={clip} action={action} />}
    <VideoEditEffectSection id="effects" title="附加效果" info={`从“效果”面板把内置效果拖到片段上，或选中片段后双击效果添加；也可以添加代码滤镜。效果从上到下依次处理画面，一个片段最多 ${VIDEO_EDIT_MAX_EFFECTS} 项。`}
      actions={<UiIconButton size="xs" aria-label="编写新滤镜源码" title="编写新滤镜源码" disabled={action.busy} onClick={() => setCreatingFilter(true)}><CodeIcon size={13} /></UiIconButton>}>
      <div className="flex flex-col gap-1 pl-5" data-video-edit-effect-chain={clipId}>
        {effects.length ? effects.map((effect, index) => {
          const open = selected?.id === effect.id
          return <div key={effect.id} className="flex flex-col">
            <div className="flex min-h-8 items-center gap-1">
              <UiOptionButton variant="menu" size="sm" className="min-w-0 flex-1 justify-start gap-1" active={open} disabled={action.busy} aria-label={`选择效果${effect.name}`} aria-expanded={open} data-video-edit-effect={effect.id} onClick={() => toggle(effect.id)}>
                {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}<span className={`truncate ${effect.enabled ? '' : 'text-text3 line-through'}`}>{effect.name}</span>
              </UiOptionButton>
              <UiIconButton size="xs" on={effect.enabled} aria-pressed={effect.enabled} aria-label={`${effect.enabled ? '停用' : '启用'}效果${effect.name}`} title={effect.enabled ? '停用此效果（保留参数）' : '启用此效果'} disabled={action.busy} onClick={() => setEnabled(effect, !effect.enabled)}><Power size={12} /></UiIconButton>
              <UiIconButton size="xs" aria-label={`重置效果${effect.name}`} title="恢复默认参数、强度和开关，并移除此效果关键帧" disabled={action.busy} onClick={() => reset(effect)}><RotateCcw size={12} /></UiIconButton>
            </div>
            {open && <div className="flex flex-col gap-1 pb-2 pl-4" data-video-edit-effect-editor={effect.id}>
              <div className="flex items-center gap-1">
                <UiFormRow density="compact" label="启用" inline className="flex-1"><UiSwitch aria-label="启用所选效果" checked={effect.enabled} disabled={action.busy} onCheckedChange={enabled => setEnabled(effect, enabled)} /></UiFormRow>
                <UiIconButton size="xs" title="提前执行" aria-label="上移效果" disabled={action.busy || index <= 0} onClick={() => move(-1)}><ArrowUp size={13} /></UiIconButton>
                <UiIconButton size="xs" title="稍后执行" aria-label="下移效果" disabled={action.busy || index >= effects.length - 1} onClick={() => move(1)}><ArrowDown size={13} /></UiIconButton>
                <UiIconButton size="xs" title="恢复默认参数、强度和开关，并移除此效果关键帧" aria-label="重置效果与关键帧" disabled={action.busy} onClick={() => reset(effect)}><RotateCcw size={13} /></UiIconButton>
                <UiIconButton size="xs" tone="danger" title="删除效果" aria-label="删除所选效果" disabled={action.busy} onClick={() => { void action.run(signal => deleteVideoEditEffects(target, [effect.id], signal), () => setSelectedId(effects[index + 1]?.id ?? effects[index - 1]?.id ?? '')) }}><Trash2 size={13} /></UiIconButton>
              </div>
              {isVideoEditBuiltinEffect(effect) ? <VideoEditBuiltinEffectControls target={target} effect={effect} onError={onError} /> : <>
                <EffectStrength key={effect.id} effect={effect} action={action} target={target} owner={instance} />
                {!action.busy && <CodeParameterPanel key={JSON.stringify([projectId, sequenceId, clipId, effect.id, effect.code?.versionId])} projectId={projectId} sequenceId={sequenceId} clipId={clipId} effectId={effect.id} onError={onError} />}
              </>}
            </div>}
          </div>
        }) : <UiEmpty size="xs" title="尚未添加效果" />}
        <div className="flex items-center gap-1 pt-1">
          <div className="min-w-0 flex-1"><Dropdown ariaLabel="选择剪辑滤镜" value={definition?.id} display={definitions.items.length ? undefined : '暂无滤镜源码'} options={definitions.options} disabled={action.busy || !definitions.items.length} onSelect={setDefinitionId} buttonClassName="w-full" /></div>
          <UiButton variant="secondary" size="sm" className="shrink-0" disabled={action.busy || !definition || effects.length >= VIDEO_EDIT_MAX_EFFECTS} onClick={() => { if (definition) void action.run(signal => createVideoEditEffect(target, { definitionId: definition.id, versionId: definition.versionId }, signal), setSelectedId) }}>添加到片段</UiButton>
        </div>
        {createdFilter && <p className="text-2xs text-text3">滤镜源码已创建，选择“添加到片段”检查并应用。</p>}
        {definitions.error ? <UiError size="xs" message={definitions.error instanceof Error ? definitions.error.message : '剪辑滤镜暂不可用。'} /> : null}
        {sources.length > 0 && <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1"><Dropdown ariaLabel="复制效果的来源片段" value={source?.value} display={source ? undefined : '从其他片段复制效果'} options={sources} disabled={action.busy} onSelect={setCopySource} buttonClassName="w-full" /></div>
          <UiIconButton size="sm" aria-label="复制并替换当前效果链" title="复制来源片段的整条效果链及关键帧，替换当前片段已有的附加效果" disabled={action.busy || !source} onClick={() => { if (source) void action.run(signal => copyVideoEditEffects(target, { sequenceId: source.sequenceId, clipId: source.clipId }, signal), () => setSelectedId('')) }}><Copy size={13} /></UiIconButton>
        </div>}
        {action.busy && <div className="flex items-center gap-2"><UiLoading size="xs" message="正在检查混合画面" /><UiButton onClick={action.cancel}>取消检查</UiButton></div>}
      </div>
    </VideoEditEffectSection>
    {creatingFilter && <VideoEditCodeCreateDialog projectId={projectId} mode="filter" onClose={() => setCreatingFilter(false)} onCreated={ids => { if (requireVideoEditInstance(projectId) === instance) { setDefinitionId(ids[0] ?? ''); setCreatedFilter(true) } }} />}
  </>
})
