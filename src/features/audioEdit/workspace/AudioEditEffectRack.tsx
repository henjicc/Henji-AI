import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Power, RotateCcw, Trash2 } from 'lucide-react'
import { PanelTrigger, UiEmpty, UiGroup, UiIconButton, UiInput, UiOptionButton, UiSwitch, UiFormRow, UI_TEXT_META_CLASS } from '@/components/ui'
import { DockHeaderPortal } from '@/components/dockLayouts/DockHeaderPortal'
import { ParamField, type ParamGesture } from '@/components/ui/params/ParamField'
import { ParamList } from '@/components/ui/params/ParamList'
import { builtinParameterFields, readBuiltinField, writeBuiltinField, type ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import NumberInput from '@/components/ui/NumberInput'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { AUDIO_EFFECT_DEFINITIONS } from '@/core/audio/effects/audioEffectDefinitions'
import { normalizeVideoEditBuiltinParams, resolveVideoEditBuiltinParams, videoEditBuiltinDefaults, videoEditBuiltinEffect, VIDEO_EDIT_BUILTIN_GROUP_NAMES, type VideoEditBuiltinEffectDefinition, type VideoEditBuiltinGroup } from '@/core/videoEdit/builtinEffects'
import { AUDIO_EDIT_MAX_EFFECTS, type AudioEditEffect } from '@/core/audioEdit/effects'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'
import { prepareAudioEditProcessing } from '../application/audioEditApplicationService'
import { beginAudioEditGesture } from '../application/audioEditProjectInstances'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

/** Audition 效果菜单的分类顺序。 */
const GROUP_ORDER: readonly string[] = ['audio_level', 'audio_dynamics', 'audio_eq', 'audio_repair', 'audio_space', 'audio_delay', 'audio_modulation', 'audio_stereo', 'audio_special', 'audio_pitch']

function groupedDefinitions(query: string): Array<[VideoEditBuiltinGroup, VideoEditBuiltinEffectDefinition[]]> {
  const needle = query.trim().toLowerCase()
  const matches = AUDIO_EFFECT_DEFINITIONS.filter(definition => !needle || definition.name.toLowerCase().includes(needle) || definition.tooltip.toLowerCase().includes(needle))
  const order = [...GROUP_ORDER, ...new Set(matches.map(definition => definition.group as string).filter(group => !GROUP_ORDER.includes(group)))] as VideoEditBuiltinGroup[]
  return order.map(group => [group, matches.filter(definition => definition.group === group)] as [VideoEditBuiltinGroup, VideoEditBuiltinEffectDefinition[]]).filter(([, items]) => items.length)
}

/** 添加效果：按 Audition 的分类列出全部内置音频效果，可搜索；悬停显示用途。 */
function EffectPicker({ onPick, disabled }: { onPick: (definition: VideoEditBuiltinEffectDefinition) => void; disabled: boolean }): React.ReactElement {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupedDefinitions(query), [query])
  return <PanelTrigger panelSize="compact" panelPadding="menu" alignment="bottomRight" closeOnPanelClick={target => target instanceof Element && !!target.closest('[data-effect-pick]')}
    renderPanel={() => <div className="flex max-h-[min(70vh,520px)] w-64 flex-col">
      <div className="p-1"><UiInput size="sm" autoFocus aria-label="搜索效果" placeholder="搜索效果" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {groups.length ? groups.map(([group, items]) => <div key={group} role="group" aria-label={VIDEO_EDIT_BUILTIN_GROUP_NAMES[group]} className="pt-1">
          <div className="px-2 pb-0.5 pt-1 text-2xs font-semibold text-text3">{VIDEO_EDIT_BUILTIN_GROUP_NAMES[group]}</div>
          {items.map(definition => <UiOptionButton key={definition.id} variant="menu" size="sm" data-effect-pick className="w-full" tooltip={definition.tooltip} onClick={() => onPick(definition)}>{definition.name}</UiOptionButton>)}
        </div>) : <p className={`m-0 px-2 py-3 ${UI_TEXT_META_CLASS}`}>没有找到“{query}”相关的效果</p>}
      </div>
    </div>}>
    {({ togglePanel }) => <UiIconButton size="sm" tooltip={disabled ? `效果组最多放 ${AUDIO_EDIT_MAX_EFFECTS} 个效果` : '添加效果'} aria-label="添加效果" disabled={disabled} onClick={togglePanel}><Plus /></UiIconButton>}
  </PanelTrigger>
}

/** 一项效果的参数（名称悬停说明、行尾重置），拖动时实时试听，松手合成一步撤销。 */
function EffectParams({ effect, onChange, gesture }: { effect: AudioEditEffect; onChange: (next: AudioEditEffect) => void; gesture: () => { finish: () => void; cancel: () => void } }): React.ReactElement {
  const definition = videoEditBuiltinEffect(effect.builtin.id)
  const active = useRef<{ finish: () => void; cancel: () => void } | null>(null)
  const latest = useRef(effect); latest.current = effect
  if (!definition) return <p className={`m-0 ${UI_TEXT_META_CLASS}`}>暂不支持此效果，已保留原设置。</p>
  const values = resolveVideoEditBuiltinParams(effect.builtin)
  const fields = builtinParameterFields(definition.params)
  const strength: ParamFieldSpec = { source: 'builtin', bindingKeys: ['amount'], key: 'amount', title: '效果强度', tooltip: '与原声混合的比例，100% 为完全应用', type: 'number', min: 0, max: 100, step: 1, unit: '%', control: 'input', default: 100, animatable: false }
  const begin = (): void => { if (!active.current) active.current = gesture() }
  const finish = (): void => { active.current?.finish(); active.current = null }
  const cancel = (): void => { active.current?.cancel(); active.current = null }
  const write = (changes: Partial<Pick<AudioEditEffect, 'amount'>> & { params?: Record<string, unknown> }): void => {
    const current = latest.current
    onChange({ ...current, ...(changes.amount !== undefined ? { amount: changes.amount } : {}), ...(changes.params ? { builtin: { ...current.builtin, params: normalizeVideoEditBuiltinParams(current.builtin.id, changes.params, current.builtin.params, true) } } : {}) })
  }
  const gestureFor = (apply: (value: CodeParameterValue) => void): ParamGesture => ({ begin, finish, cancel, active: () => !!active.current, write: apply, atomic: value => { begin(); apply(value); finish() } })
  return <div className="flex flex-col" data-audio-edit-effect-params={effect.builtin.id}>
    <ParamList fields={fields} values={Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, values)]))}
      renderControl={(field, value) => <ParamField field={field} value={value} gesture={gestureFor(next => write({ params: writeBuiltinField(field, next) }))} />}
      onReset={field => write({ params: Object.fromEntries(field.bindingKeys.map(key => [key, definition.params.find(param => param.key === key)!.default])) })}
      resetDisabled={field => field.bindingKeys.every(key => values[key] === definition.params.find(param => param.key === key)!.default)} />
    <ParamList fields={[strength]} values={{ amount: Math.round(effect.amount * 100) }} onReset={() => write({ amount: 1 })} resetDisabled={(_, value) => value === 100}
      renderControl={(field, value) => <ParamField field={field} value={value} gesture={gestureFor(next => write({ amount: Number(next) / 100 }))} />} />
  </div>
}

/**
 * 效果组（参照 Audition）：一列效果槽，按顺序处理剪好的整条声音；每槽有开关、名称、更多菜单，点名称展开参数。
 * 标签行右侧放“全部开关”和“添加效果”；拖动参数时实时试听。VST3 插件需要先离线处理，单列在下方。
 */
export function AudioEditEffectRack(): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  const { project, update, processors, run } = workspace
  const effects = project.effects ?? []
  const [openId, setOpenId] = useState<string | null>(effects[0]?.id ?? null)
  const bypassed = project.effectsBypassed === true
  const disabled = workspace.disabled
  const gesture = () => beginAudioEditGesture(project.id)
  const setEffects = (next: AudioEditEffect[]): void => update({ effects: next })
  const add = (definition: VideoEditBuiltinEffectDefinition): void => {
    const effect: AudioEditEffect = { id: crypto.randomUUID(), name: definition.name, enabled: true, amount: 1, builtin: { id: definition.id, params: videoEditBuiltinDefaults(definition) } }
    setEffects([...effects, effect]); setOpenId(effect.id)
  }
  const replace = (id: string, next: AudioEditEffect): void => setEffects(effects.map(effect => effect.id === id ? next : effect))
  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= effects.length) return
    const next = [...effects]; const [item] = next.splice(index, 1); next.splice(target, 0, item); setEffects(next)
  }
  const plugins = processors.filter(item => item.available && item.semanticRole)
  const tools = <div className="flex items-center gap-0.5">
    <UiIconButton size="sm" on={!bypassed && effects.length > 0} aria-pressed={!bypassed} disabled={disabled || !effects.length} tooltip={bypassed ? '效果组已关闭：试听与导出都不经过效果组（基本声音照常）' : '关闭整个效果组，对比处理前后的声音'} aria-label="效果组开关" onClick={() => update({ effectsBypassed: !bypassed })}><Power /></UiIconButton>
    <EffectPicker disabled={disabled || effects.length >= AUDIO_EDIT_MAX_EFFECTS} onPick={add} />
  </div>
  return <div className="flex h-full min-h-0 flex-col" data-audio-edit-panel="effects">
    <DockHeaderPortal panelId="audio_edit:effects" fallback={children => <div className="flex shrink-0 justify-end px-2 pt-1">{children}</div>}>{tools}</DockHeaderPortal>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1" aria-label="效果组">
      {!effects.length ? <UiEmpty size="node" title="效果组是空的" description="点标签栏的加号添加效果；想一键处理人声，用“基本声音”。" /> : <div role="list" aria-label="效果组" className={`flex flex-col ${bypassed ? 'opacity-60' : ''}`}>
        {effects.map((effect, index) => {
          const open = openId === effect.id
          const definition = videoEditBuiltinEffect(effect.builtin.id)
          return <div key={effect.id} role="listitem" className="flex flex-col" data-audio-edit-effect-slot={effect.builtin.id}>
            <div className="group flex h-8 min-w-0 items-center gap-1">
              <UiIconButton size="xs" on={effect.enabled} aria-pressed={effect.enabled} tooltip={effect.enabled ? '关闭这个效果' : '打开这个效果'} aria-label={`${effect.name}开关`} disabled={disabled} onClick={() => replace(effect.id, { ...effect, enabled: !effect.enabled })}><Power /></UiIconButton>
              <UiOptionButton variant="menu" size="sm" active={open} className="min-w-0 flex-1" aria-expanded={open} tooltip={definition?.tooltip} onClick={() => setOpenId(open ? null : effect.id)}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {open ? <ChevronDown size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" /> : <ChevronRight size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" />}
                  <span className="w-4 shrink-0 text-right font-mono text-2xs tabular-nums text-text3">{index + 1}</span>
                  <span className={`truncate ${effect.enabled ? '' : 'text-text3'}`}>{effect.name}</span>
                </span>
              </UiOptionButton>
              <PanelTrigger panelSize="menu" panelPadding="menu" alignment="bottomRight" closeOnPanelClick
                renderPanel={() => <div className="flex flex-col">
                  <UiOptionButton variant="menu" size="sm" disabled={index === 0} onClick={() => move(index, -1)}>上移</UiOptionButton>
                  <UiOptionButton variant="menu" size="sm" disabled={index === effects.length - 1} onClick={() => move(index, 1)}>下移</UiOptionButton>
                  <UiOptionButton variant="menu" size="sm" disabled={!definition} onClick={() => definition && replace(effect.id, { ...effect, amount: 1, builtin: { ...effect.builtin, params: videoEditBuiltinDefaults(definition) } })}><span className="flex items-center gap-2"><RotateCcw size={UI_ICON_SIZE.xs} />恢复默认参数</span></UiOptionButton>
                  <UiOptionButton variant="menu" size="sm" onClick={() => setEffects(effects.filter(item => item.id !== effect.id))}><span className="flex items-center gap-2 text-danger-text"><Trash2 size={UI_ICON_SIZE.xs} />移除</span></UiOptionButton>
                </div>}>
                {({ togglePanel }) => <UiIconButton size="xs" aria-label={`${effect.name}更多操作`} tooltip="更多" disabled={disabled} onClick={togglePanel}><MoreHorizontal /></UiIconButton>}
              </PanelTrigger>
            </div>
            {open && <div className="pb-2 pl-6"><fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0"><EffectParams effect={effect} gesture={gesture} onChange={next => replace(effect.id, next)} /></fieldset></div>}
          </div>
        })}
      </div>}
      {plugins.length > 0 && <UiGroup divided titleTone="compact" title="VST3 插件" description="插件要先整段离线处理，改动后重新打开“试听时启用”。">
        <UiFormRow label="试听时启用" density="compact" inline><UiSwitch aria-label="试听时启用插件" checked={project.vstEnabled} disabled={disabled} onCheckedChange={value => void run(async () => { if (value) await prepareAudioEditProcessing(project.id, crypto.randomUUID()); workspace.setVstEnabled(value) })} /></UiFormRow>
        {plugins.map(plugin => {
          const entry = project.processorChain?.find(item => item.id === plugin.id)
          return <div key={plugin.id} className="flex flex-col">
            <UiFormRow label={plugin.name} density="compact" inline><UiSwitch aria-label={plugin.name} checked={Boolean(entry?.enabled)} disabled={disabled} onCheckedChange={enabled => update({ vstEnabled: false, processorChain: [...(project.processorChain ?? []).filter(item => item.id !== plugin.id).map(item => processors.find(p => p.id === item.id)?.semanticRole === plugin.semanticRole ? { ...item, enabled: false } : item), { id: plugin.id, enabled, parameters: entry?.parameters ?? {} }] })} /></UiFormRow>
            {entry?.enabled && plugin.parameters?.map(parameter => <UiFormRow key={parameter.id} label={parameter.name} density="compact"><NumberInput ariaLabel={parameter.name} size="sm" min={0} max={1} step={0.01} precision={2} commitOnChange value={entry.parameters[parameter.name] ?? parameter.normalizedValue} onChange={next => update({ vstEnabled: false, processorChain: project.processorChain?.map(item => item.id === plugin.id ? { ...item, parameters: { ...item.parameters, [parameter.name]: next } } : item) })} /></UiFormRow>)}
          </div>
        })}
      </UiGroup>}
    </div>
  </div>
}
