import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Power, RotateCcw, Trash2 } from 'lucide-react'
import { PanelTrigger, UiFieldLayoutContext, UiIconButton, UiInput, UiOptionButton, UiPropertyMenuContext, UI_TEXT_META_CLASS } from '@/components/ui'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ParamField, type ParamGesture } from '@/components/ui/params/ParamField'
import { ParamList } from '@/components/ui/params/ParamList'
import { builtinParameterFields, readBuiltinField, writeBuiltinField, type ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { UI_DIVIDER_CLASS, UI_PANEL_BODY_HEIGHT_CLASS } from '@/components/ui/styleTokens'
import { AUDIO_EFFECT_DEFINITIONS } from '@/core/audio/effects/audioEffectDefinitions'
import { normalizeVideoEditBuiltinParams, resolveVideoEditBuiltinParams, videoEditBuiltinDefaults, videoEditBuiltinEffect, VIDEO_EDIT_BUILTIN_GROUP_NAMES, type VideoEditBuiltinEffectDefinition, type VideoEditBuiltinGroup } from '@/core/videoEdit/builtinEffects'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'
import type { AudioRackEffect } from '@/core/audio/effects/rackEffect'

/*
 * 效果组的通用部分（参照 Audition 的效果组）：选效果菜单、效果槽列表与每个效果的参数。
 * 音频编辑的效果组、剪辑音轨混合器里每条轨道与主轨的效果都用它；写入交给宿主。
 */

export type AudioRackGesture = () => { finish: () => void; cancel: () => void }


/** Audition 效果菜单的分类顺序。 */
const GROUP_ORDER: readonly string[] = ['audio_level', 'audio_dynamics', 'audio_eq', 'audio_repair', 'audio_space', 'audio_delay', 'audio_modulation', 'audio_stereo', 'audio_special', 'audio_pitch']

function groupedDefinitions(query: string): Array<[VideoEditBuiltinGroup, VideoEditBuiltinEffectDefinition[]]> {
  const needle = query.trim().toLowerCase()
  const matches = AUDIO_EFFECT_DEFINITIONS.filter(definition => !needle || definition.name.toLowerCase().includes(needle) || definition.tooltip.toLowerCase().includes(needle))
  const order = [...GROUP_ORDER, ...new Set(matches.map(definition => definition.group as string).filter(group => !GROUP_ORDER.includes(group)))] as VideoEditBuiltinGroup[]
  return order.map(group => [group, matches.filter(definition => definition.group === group)] as [VideoEditBuiltinGroup, VideoEditBuiltinEffectDefinition[]]).filter(([, items]) => items.length)
}

/** 效果菜单里的宿主专属项（如音频编辑的“去除口水音”）：列在对应分类末尾，点了交给宿主执行，不进效果组。 */
export interface AudioEffectPickerExtra { id: string; name: string; tooltip: string; group: VideoEditBuiltinGroup; onPick: () => void }

/** 添加效果：按 Audition 的分类列出全部内置音频效果，可搜索；悬停显示用途。 */
export function AudioEffectPicker({ onPick, disabled, disabledReason, extras = [] }: { onPick: (definition: VideoEditBuiltinEffectDefinition) => void; disabled: boolean; disabledReason?: string; extras?: readonly AudioEffectPickerExtra[] }): React.ReactElement {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupedDefinitions(query), [query])
  const needle = query.trim().toLowerCase()
  const extraIn = (group: VideoEditBuiltinGroup) => extras.filter(extra => extra.group === group && (!needle || extra.name.toLowerCase().includes(needle) || extra.tooltip.toLowerCase().includes(needle)))
  const shown = [...groups.map(([group, items]) => [group, items, extraIn(group)] as const),
    ...[...new Set(extras.map(extra => extra.group))].filter(group => !groups.some(([listed]) => listed === group)).map(group => [group, [] as VideoEditBuiltinEffectDefinition[], extraIn(group)] as const)]
    .filter(([, items, more]) => items.length + more.length > 0)
  const option = (key: string, name: string, tooltip: string, pick: () => void) => <UiOptionButton key={key} variant="menu" size="sm" data-effect-pick className="w-full" tooltip={tooltip} onClick={pick}>{name}</UiOptionButton>
  // 只有列表一层滚动：高度按浮层实际能给的封顶（UI_PANEL_BODY_HEIGHT_CLASS），浮层外壳不再另滚一层。
  // 分类标题用主文字加粗、上方一条分隔线，效果项缩进在标题下面，分类一眼能分开。
  return <PanelTrigger panelSize="compact" panelPadding="menu" alignment="bottomRight" closeOnPanelClick={target => target instanceof Element && !!target.closest('[data-effect-pick]')}
    renderPanel={() => <div className={`flex w-64 flex-col ${UI_PANEL_BODY_HEIGHT_CLASS.content}`}>
      <div className="shrink-0 p-1"><UiInput size="sm" autoFocus aria-label="搜索效果" placeholder="搜索效果" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
        {shown.length ? shown.map(([group, items, more], index) => <div key={group} role="group" aria-label={VIDEO_EDIT_BUILTIN_GROUP_NAMES[group]} className={index ? `mt-1 pt-1 ${UI_DIVIDER_CLASS}` : ''}>
          <div className="px-2 pb-0.5 pt-1.5 text-xs font-semibold text-text1">{VIDEO_EDIT_BUILTIN_GROUP_NAMES[group]}</div>
          <div className="pl-2">
            {items.map(definition => option(definition.id, definition.name, definition.tooltip, () => onPick(definition)))}
            {more.map(extra => option(extra.id, extra.name, extra.tooltip, extra.onPick))}
          </div>
        </div>) : <p className={`m-0 px-2 py-3 ${UI_TEXT_META_CLASS}`}>没有找到“{query}”相关的效果</p>}
      </div>
    </div>}>
    {({ togglePanel }) => <UiIconButton size="sm" tooltip={disabled && disabledReason ? disabledReason : '添加效果'} aria-label="添加效果" disabled={disabled} onClick={togglePanel}><Plus /></UiIconButton>}
  </PanelTrigger>
}

/** 一项效果的参数（名称悬停说明、右键重置，与剪辑“效果控件”一致），拖动时实时试听，松手合成一步撤销。 */
function EffectParams({ effect, onChange, gesture }: { effect: AudioRackEffect; onChange: (next: AudioRackEffect) => void; gesture: AudioRackGesture }): React.ReactElement {
  const definition = videoEditBuiltinEffect(effect.builtin.id)
  const active = useRef<{ finish: () => void; cancel: () => void } | null>(null)
  const latest = useRef(effect); latest.current = effect
  const menu = useContextMenu()
  if (!definition) return <p className={`m-0 ${UI_TEXT_META_CLASS}`}>暂不支持此效果，已保留原设置。</p>
  const values = resolveVideoEditBuiltinParams(effect.builtin)
  // 音频参数配滑杆（拖动时实时试听），读数仍可直接输入与左右拖动。
  const fields = builtinParameterFields(definition.params).map(field => field.type === 'number' ? { ...field, control: 'slider' as const } : field)
  const strength: ParamFieldSpec = { source: 'builtin', bindingKeys: ['amount'], key: 'amount', title: '效果强度', tooltip: '与原声混合的比例，100% 为完全应用', type: 'number', min: 0, max: 100, step: 1, unit: '%', control: 'slider', default: 100, animatable: false }
  const begin = (): void => { if (!active.current) active.current = gesture() }
  const finish = (): void => { active.current?.finish(); active.current = null }
  const cancel = (): void => { active.current?.cancel(); active.current = null }
  const write = (changes: Partial<Pick<AudioRackEffect, 'amount'>> & { params?: Record<string, unknown> }): void => {
    const current = latest.current
    onChange({ ...current, ...(changes.amount !== undefined ? { amount: changes.amount } : {}), ...(changes.params ? { builtin: { ...current.builtin, params: normalizeVideoEditBuiltinParams(current.builtin.id, changes.params, current.builtin.params, true) as AudioRackEffect['builtin']['params'] } } : {}) })
  }
  const gestureFor = (apply: (value: CodeParameterValue) => void): ParamGesture => ({ begin, finish, cancel, active: () => !!active.current, write: apply, atomic: value => { begin(); apply(value); finish() } })
  // 与剪辑“效果控件”同一种属性排布：名称在左，滑杆与读数在右一行。
  return <UiFieldLayoutContext.Provider value="property"><UiPropertyMenuContext.Provider value={menu.showMenu}><div className="flex flex-col" data-audio-effect-params={effect.builtin.id}>
    <ParamList fields={fields} values={Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, values)]))}
      renderControl={(field, value) => <ParamField field={field} value={value} gesture={gestureFor(next => write({ params: writeBuiltinField(field, next) }))} />}
      onReset={field => write({ params: Object.fromEntries(field.bindingKeys.map(key => [key, definition.params.find(param => param.key === key)!.default])) })}
      resetDisabled={field => field.bindingKeys.every(key => values[key] === definition.params.find(param => param.key === key)!.default)} />
    <ParamList fields={[strength]} values={{ amount: Math.round(effect.amount * 100) }} onReset={() => write({ amount: 1 })} resetDisabled={(_, value) => value === 100}
      renderControl={(field, value) => <ParamField field={field} value={value} gesture={gestureFor(next => write({ amount: Number(next) / 100 }))} />} />
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
  </div></UiPropertyMenuContext.Provider></UiFieldLayoutContext.Provider>
}


/**
 * 效果槽列表：每槽开关、序号与名称、更多菜单（上移 / 下移 / 恢复默认参数 / 移除），点名称展开参数。
 * effects 为空时显示 empty（宿主给出的空状态）。
 */
export function AudioEffectSlots({ effects, onChange, gesture, disabled, bypassed = false, empty }: { effects: readonly AudioRackEffect[]; onChange: (next: AudioRackEffect[]) => void; gesture: AudioRackGesture; disabled: boolean; bypassed?: boolean; empty: React.ReactNode }): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(effects[0]?.id ?? null)
  // 新加的效果自动展开参数（与 Audition 加效果后弹出参数一样）。
  const known = useRef(new Set(effects.map(effect => effect.id)))
  const added = effects.find(effect => !known.current.has(effect.id))
  if (added) { known.current = new Set(effects.map(effect => effect.id)); if (openId !== added.id) setOpenId(added.id) }
  const setEffects = (next: AudioRackEffect[]): void => onChange(next)
  const replace = (id: string, next: AudioRackEffect): void => setEffects(effects.map(effect => effect.id === id ? next : effect))
  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= effects.length) return
    const next = [...effects]; const [item] = next.splice(index, 1); next.splice(target, 0, item); setEffects(next)
  }
  return <>
      {!effects.length ? empty : <div role="list" aria-label="效果组" className={`flex flex-col ${bypassed ? 'opacity-60' : ''}`}>
        {effects.map((effect, index) => {
          const open = openId === effect.id
          const definition = videoEditBuiltinEffect(effect.builtin.id)
          return <div key={effect.id} role="listitem" className="flex flex-col" data-audio-effect-slot={effect.builtin.id}>
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
  </>
}
