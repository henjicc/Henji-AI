import { useState } from 'react'
import { RotateCcw, Timer, Trash2 } from 'lucide-react'
import { UiFormRow, UiIconButton, UiSwitch, useUiPropertyMenu } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS, UI_PROPERTY_REVEAL_CLASS } from '@/components/ui/styleTokens'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import NumberInput from '@/components/ui/NumberInput'
import { EffectSection } from '@/components/effects/EffectSection'
import { PropertyHeading } from '@/components/ui/params/ParamList'
import type { ImagingParam } from '@/core/imaging/parameterDefinition'
import { videoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import { authorEffectEnvironmentForClip, resolveVideoEditLookByName, type AuthorElementEffectState } from '@/core/videoEdit/authorEffects'
import { CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { codeEditKey } from '@/core/videoEdit/codeEdits'
import type { CodeElementOverrideKey, CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { readVideoEditCodeEditor } from '../application/videoEditCodeParameters'
import { readVideoEditCodeElementEdit, videoEditCodeElementEffectStates, videoEditCodeElementKind, videoEditCodeElementWriter, type VideoEditCodeElementTarget } from '../application/videoEditCodeElementEditing'
import { useVideoEditTypographyGesture } from './useVideoEditTypographyGesture'
import { useVideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { BuiltinField } from './VideoEditBuiltinEffectControls'
import { VideoEditParameterFields } from './CodeParameterPanel'
import { builtinParameterFields, readBuiltinField } from './params/fieldSpec'
import { ParamList } from './params/ParamList'
import { latestCodeEditNote } from './codeEditNote'
import { handleVideoEditElementEffectDragOver, handleVideoEditElementEffectDrop } from './videoEditEffectDrag'

const writer = videoEditCodeElementWriter('user')
type Current = ReturnType<typeof readVideoEditCodeElementEdit>

/** 秒表：开着动画时常驻并染强调色；没开时与其他属性行一样，悬停或聚焦本行才出现。 */
function Stopwatch({ animated, label, onToggle }: { animated: boolean; label: string; onToggle: () => void }): React.ReactElement {
  const name = `${animated ? '关闭' : '启用'}${label}关键帧`
  return <span className={animated ? 'flex' : `flex ${UI_PROPERTY_REVEAL_CLASS}`}><UiIconButton size="2xs" on={animated} aria-pressed={animated} aria-label={name} tooltip={name} onClick={onToggle}><Timer /></UiIconButton></span>
}

function Block({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(true)
  return <div className="flex flex-col" data-code-element-block={title}>
    <PropertyHeading label={title} name={`${open ? '收起' : '展开'}${title}`} open={open} onToggle={() => setOpen(value => !value)} />
    {open && children}
  </div>
}

const TRANSFORM_FIELDS: ReadonlyArray<[CodeElementOverrideKey, string, number, number]> = [['dx', '水平位移', -32768, 32768], ['dy', '垂直位移', -32768, 32768], ['scale', '整体比例', .001, 1024], ['scaleX', '水平比例', .001, 1024], ['scaleY', '垂直比例', .001, 1024], ['rotation', '旋转', -32768, 32768], ['opacity', '不透明度', 0, 1]]

function Transform({ target, current, adjust, onError }: { target: VideoEditCodeElementTarget; current: Current; adjust: boolean; onError: (error: unknown) => void }): React.ReactElement {
  const identity = `${JSON.stringify(target)}:${JSON.stringify(current.time)}`
  const gesture = useVideoEditTypographyGesture(target.projectId, identity, onError)
  const menu = useUiPropertyMenu()
  const edits = current.element?.author.edits
  const write = (patch: CodeElementOverrideValues): void => { try { writer.updateVideoEditCodeElement(target, patch, { gesture: gesture.handle.current, time: current.time }) } catch (error) { gesture.end(false); onError(error) } }
  const run = (operation: () => void): void => { try { gesture.end(true); operation() } catch (error) { onError(error) } }
  const changed = (key: CodeElementOverrideKey): boolean => current.override[key] !== undefined || Boolean(current.override.curves?.[key])
  // 调整层没有画面范围：只有不透明度与显示（与写入时的可写性一致）。
  const fields = adjust ? TRANSFORM_FIELDS.filter(([key]) => key === 'opacity') : TRANSFORM_FIELDS
  const reset = (key: CodeElementOverrideKey, label: string) => ({
    modified: changed(key) ? latestCodeEditNote(edits, [codeEditKey.element(target.elementId, key)]) : undefined,
    onContextMenu: menu && changed(key) ? (event: React.MouseEvent) => menu(event, [{ id: 'reset', label: `重置${label}`, icon: <RotateCcw size={UI_ICON_SIZE.sm} />, onClick: () => run(() => writer.resetVideoEditCodeElementField(target, key)) }]) : undefined,
    trailing: !menu && changed(key) ? <UiIconButton size="2xs" aria-label={`重置${label}`} tooltip={`重置${label}`} onClick={() => run(() => writer.resetVideoEditCodeElementField(target, key))}><RotateCcw /></UiIconButton> : undefined,
  })
  return <Block title="变换">
    {fields.map(([key, label, min, max]) => {
      return <UiFormRow key={key} label={label} {...reset(key, label)} leading={<Stopwatch animated={Boolean(current.override.curves?.[key])} label={`元素${label}`} onToggle={() => run(() => writer.toggleVideoEditCodeElementKeyframe(target, key))} />}>
        <NumberInput size="sm" ariaLabel={`元素${label}`} value={Number(current.values[key] ?? (key === 'dx' || key === 'dy' || key === 'rotation' ? 0 : 1))} min={min} max={max} step={key.startsWith('scale') || key === 'opacity' ? .01 : 1} precision={2} align="right" onScrubStart={gesture.begin} onScrubEnd={cancelled => gesture.end(!cancelled)} onChange={value => write({ [key]: value })} />
      </UiFormRow>
    })}
    <UiFormRow label="显示" {...reset('hidden', '显示')}><UiSwitch aria-label="显示元素" checked={!current.values.hidden} onCheckedChange={visible => write({ hidden: !visible })} /></UiFormRow>
  </Block>
}

function Properties({ target, keys, onError }: { target: VideoEditCodeElementTarget; keys: readonly string[]; onError: (error: unknown) => void }): React.ReactElement | null {
  const editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)
  if (!keys.length) return null
  return <Block title="属性"><VideoEditParameterFields editor={editor} parameterKeys={keys} onError={onError} bare /></Block>
}

/** 一项元素效果：参数定义、分组、显隐与说明取内置效果登记表（与片段效果控件同一份）；风格件只露出旋钮。 */
function ElementEffect({ target, current, state, space, onError }: { target: VideoEditCodeElementTarget; current: Current; state: AuthorElementEffectState; space: 'layer' | 'frame'; onError: (error: unknown) => void }): React.ReactElement {
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, JSON.stringify([target, state.key, state.added]), (changes, handle) => writer.updateVideoEditCodeElementEffect(target, state.key, { values: changes.params as Record<string, string | number | boolean> }, { gesture: handle, time: current.time }), onError)
  const run = (operation: () => void): void => { try { gesture.finish(); operation() } catch (error) { onError(error) } }
  const edits = current.element?.author.edits
  const definition = state.id === 'look' ? undefined : videoEditBuiltinEffect(state.id)
  const look = state.id === 'look' && state.name !== undefined ? (() => { try { return resolveVideoEditLookByName(state.name!, authorEffectEnvironmentForClip(current.owner.document, current.clip), space, current.program.apiVersion) } catch { return undefined } })() : undefined
  const knobs: ImagingParam[] = look?.knobs?.map(knob => ({ key: knob.key, name: knob.name, description: '', type: 'number', unit: 'value', min: knob.min, max: knob.max, step: 1, default: knob.default })) ?? []
  const params = definition?.params ?? knobs
  const title = state.name ?? definition?.name ?? state.key
  const added = current.override.addedEffects?.find(effect => effect.key === state.key)
  const curves = added ? added.curves : current.override.effects && Object.hasOwn(current.override.effects, state.key) ? current.override.effects[state.key].curves : undefined
  const fields = builtinParameterFields(params, space)
  const values = Object.fromEntries(params.map(param => [param.key, state.values[param.key] ?? param.default]))
  const effectKey = (field: string): string => codeEditKey.effect(target.elementId, state.key, field)
  const modified = state.added ? {} : Object.fromEntries(fields.flatMap(field => field.bindingKeys.some(key => state.overridden.includes(key)) ? [[field.key, latestCodeEditNote(edits, field.bindingKeys.map(effectKey))]] : []))
  const changed = state.added || !state.enabled || state.overridden.length > 0
  const name = `效果${title}`
  const resetAction = state.added
    ? <UiIconButton size="2xs" tone="danger" aria-label={`移除${name}`} tooltip="移除这项追加的效果" onClick={() => run(() => writer.resetVideoEditCodeElementEffect(target, state.key))}><Trash2 /></UiIconButton>
    : changed ? <UiIconButton size="2xs" aria-label={`重置${name}`} tooltip="恢复代码给的值并启用" onClick={() => run(() => writer.resetVideoEditCodeElementEffect(target, state.key))}><RotateCcw /></UiIconButton> : undefined
  return <EffectSection id={`code-element-effect:${target.elementId}:${state.added}:${state.key}`} title={title} actions={resetAction}
    modified={state.added ? latestCodeEditNote(edits, [codeEditKey.added(target.elementId, state.key)], '代码之外追加的效果') : undefined}
    {...(state.added || state.missing ? {} : { enabled: state.enabled, onEnabledChange: (enabled: boolean) => run(() => writer.updateVideoEditCodeElementEffect(target, state.key, { enabled })), toggleLabel: `${state.enabled ? '停用' : '启用'}${name}`, toggleTooltip: state.enabled ? '停用此效果（代码不动）' : '启用此效果' })}>
    {state.missing
      ? <p className={`py-1 text-2xs text-text3 ${UI_PROPERTY_INSET_CLASS}`}>此处代码没有这个效果，改动已保留</p>
      : <div className="flex flex-col" data-code-element-effect={state.key}>
        <ParamList key={gesture.identity} fields={fields} values={Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, values)]))} initiallyOpenGroups={[]} modified={modified} contextKey={JSON.stringify(current.time)}
          extras={Object.fromEntries(fields.map(field => [field.key, field.bindingKeys.map(key => curves?.[key])]))}
          renderControl={(field, value) => <BuiltinField field={field} value={value} gesture={gesture} />}
          onReset={field => run(() => writer.resetVideoEditCodeElementEffectParams(target, state.key, field.bindingKeys))}
          resetDisabled={field => state.added ? field.bindingKeys.every(key => values[key] === params.find(param => param.key === key)?.default && !curves?.[key]) : !field.bindingKeys.some(key => state.overridden.includes(key) || curves?.[key])}
          renderAnimation={field => {
            // 一个秒表管整行：有任一分量在动画就整行关掉，否则整行打开，只切换状态不一致的分量。
            const animated = field.bindingKeys.some(key => curves?.[key]?.length)
            return { leading: <Stopwatch animated={animated} label={field.title} onToggle={() => run(() => { for (const key of field.bindingKeys) if (Boolean(curves?.[key]?.length) === animated) writer.toggleVideoEditCodeElementEffectKeyframe(target, state.key, key) })} /> }
          }} />
      </div>}
  </EffectSection>
}

function Effects({ target, current, space, onError }: { target: VideoEditCodeElementTarget; current: Current; space: 'layer' | 'frame'; onError: (error: unknown) => void }): React.ReactElement | null {
  const states = videoEditCodeElementEffectStates(current)
  if (!states.length) return null
  return <Block title="效果">{states.map(state => <ElementEffect key={`${state.added}:${state.key}`} target={target} current={current} state={state} space={space} onError={onError} />)}</Block>
}

/**
 * 效果控件里选中的代码元素（对齐 AE 图层属性）：变换、绑定到它的作者参数、它的效果链三块。改过的值名称前一个中性小点，
 * 悬停看谁何时改的，右键名称重置回代码值；从效果面板拖效果到这里或画面选框上，追加到它的效果链末尾。
 */
export function VideoEditCodeElementView({ target, keys, onError }: { target: VideoEditCodeElementTarget; keys: readonly string[]; onError: (error: unknown) => void }): React.ReactElement {
  const current = readVideoEditCodeElementEdit(target)
  const adjust = videoEditCodeElementKind(current, target.elementId) === 'adjust'
  const effects = codeMaterialVersion(current.owner.document, current.clip.code!).apiVersion >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION
  return <div className="flex flex-col" data-code-element-view={target.elementId}
    onDragOver={event => { handleVideoEditElementEffectDragOver(event, target.projectId) }}
    onDrop={event => { handleVideoEditElementEffectDrop(event, target, onError) }}>
    <Transform target={target} current={current} adjust={adjust} onError={onError} />
    <Properties target={target} keys={keys} onError={onError} />
    {effects && <Effects target={target} current={current} space={adjust ? 'frame' : 'layer'} onError={onError} />}
  </div>
}
