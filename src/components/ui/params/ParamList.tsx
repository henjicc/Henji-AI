import { isValidElement, memo, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { UiButton, UiIconButton } from '../primitives'
import { UiFormRow, UiGroup, UiTooltipText } from '../layout'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'
import type { ParamFieldSpec } from './fieldSpec'
import { useUiFieldLayout, useUiPropertyMenu } from '../fieldLayout'
import { UI_ICON_SIZE } from '@/core/theme/icons'

export interface ParamListProps {
  fields: readonly ParamFieldSpec[]
  values: Readonly<Record<string, CodeParameterValue>>
  /** Per-field animation data is subscribed alongside that field's value. */
  extras?: Readonly<Record<string, unknown>>
  initiallyOpenGroups?: readonly string[]
  contextKey?: string
  renderControl: (field: ParamFieldSpec, value: CodeParameterValue) => ReactNode
  /**
   * 参数的动画控件。属性面板排布里返回 `{ leading, labelTrailing }`：秒表进秒表列、关键帧导航跟在名称后；
   * 返回普通节点时整块放在这一行下方（代码参数的关键帧列表）。
   */
  renderAnimation?: (field: ParamFieldSpec, value: CodeParameterValue) => ReactNode | ParamAnimationSlots
  onReset?: (field: ParamFieldSpec) => void
  resetDisabled?: (field: ParamFieldSpec, value: CodeParameterValue) => boolean
  highlightedKeys?: readonly string[]
}
export interface ParamAnimationSlots { leading: ReactNode; labelTrailing?: ReactNode }
const isAnimationSlots = (value: unknown): value is ParamAnimationSlots => typeof value === 'object' && value !== null && !isValidElement(value) && 'leading' in value
/** 属性面板里需要整行宽度的控件：名称单独一行，控件在下面占满名称列与数值列。 */
const WIDE_TYPES = new Set<ParamFieldSpec['type']>(['textStyle', 'table', 'curve', 'grade', 'gradient', 'point', 'text', 'custom', 'image', 'audio', 'range'])

function paramVisible(field: ParamFieldSpec, values: Readonly<Record<string, CodeParameterValue>>): boolean {
  const condition = field.visibleWhen
  if (!condition) return true
  const value = values[condition.param]
  if ('equals' in condition) return value === condition.equals
  if ('notEquals' in condition) return value !== condition.notEquals
  return condition.in?.some(candidate => candidate === value) ?? true
}

/** Local projection of authoritative values; listeners are indexed by field key. */
function createFieldStore() {
  const snapshots = new Map<string, string>()
  const listeners = new Map<string, Set<() => void>>()
  let current: ParamListProps
  return {
    get props() { return current },
    update(props: ParamListProps, notify: boolean) {
      current = props
      for (const field of props.fields) {
        const snapshot = JSON.stringify([props.values[field.key], props.extras?.[field.key], paramVisible(field, props.values), props.contextKey, props.highlightedKeys?.includes(field.key)])
        if (snapshots.get(field.key) === snapshot) continue
        snapshots.set(field.key, snapshot)
        if (notify) listeners.get(field.key)?.forEach(listener => listener())
      }
    },
    snapshot(key: string) { return snapshots.get(key) ?? '' },
    subscribe(key: string, listener: () => void) {
      const set = listeners.get(key) ?? new Set<() => void>(); set.add(listener); listeners.set(key, set)
      return () => { set.delete(listener); if (!set.size) listeners.delete(key) }
    },
  }
}
type FieldStore = ReturnType<typeof createFieldStore>
const FieldRow = memo(function FieldRow({ field, store }: { field: ParamFieldSpec; store: FieldStore }) {
  const snapshot = useSyncExternalStore(listener => store.subscribe(field.key, listener), () => store.snapshot(field.key))
  const property = useUiFieldLayout() === 'property'
  const menu = useUiPropertyMenu()
  // 新字段在本轮布局提交时发布；字段集合切换的首次渲染尚无快照。
  if (!snapshot) return null
  const [value, , visible, , highlighted] = JSON.parse(snapshot) as [CodeParameterValue, unknown, boolean, string, boolean]
  if (!visible) return null
  const props = store.props
  if (property) {
    // 属性面板（重要记录 019）：一行四列，秒表在秒表列，重置在名称上的右键菜单（没有宿主菜单时退回行尾按钮）。
    const animation = field.animatable ? props.renderAnimation?.(field, value) : undefined
    const slots = isAnimationSlots(animation) ? animation : undefined
    const resetLabel = `重置${field.title}`
    const reset = props.onReset && (() => store.props.onReset?.(field))
    const resetDisabled = props.resetDisabled?.(field, value)
    return <div className={highlighted ? 'bg-selected-accent' : undefined} data-video-edit-code-parameter={field.source === 'code' ? field.key : undefined} data-video-edit-builtin-param={field.source === 'builtin' ? field.key : undefined} data-code-element-parameter={highlighted || undefined}>
      <UiFormRow label={field.title} info={field.tooltip} wide={WIDE_TYPES.has(field.type)} leading={slots?.leading} labelTrailing={slots?.labelTrailing}
        trailing={reset && !menu ? <UiIconButton size="2xs" aria-label={resetLabel} tooltip={resetLabel} disabled={resetDisabled} onClick={reset}><RotateCcw /></UiIconButton> : undefined}
        onContextMenu={reset && menu ? event => menu(event, [{ id: 'reset', label: resetLabel, icon: <RotateCcw size={UI_ICON_SIZE.sm} />, disabled: resetDisabled, onClick: reset }]) : undefined}>
        {props.renderControl(field, value)}
      </UiFormRow>
      {isAnimationSlots(animation) ? null : animation}
    </div>
  }
  const wheel = field.type === 'textStyle' || field.type === 'table' || (field.type === 'grade' && field.layout === 'wheel') || (field.type === 'curve' && field.source === 'builtin')
  return <div className={highlighted ? 'flex flex-col gap-1 bg-selected-accent' : 'flex flex-col gap-1'} data-video-edit-code-parameter={field.source === 'code' ? field.key : undefined} data-video-edit-builtin-param={field.source === 'builtin' ? field.key : undefined} data-code-element-parameter={highlighted || undefined}>
    {wheel ? <div className="flex min-h-8 items-start gap-1.5"><span className="min-w-0 flex-1 pt-1 text-xs text-text2"><UiTooltipText tooltip={field.tooltip}>{field.title}</UiTooltipText></span>{props.onReset && <UiIconButton size="2xs" aria-label={`重置${field.title}`} tooltip={`重置${field.title}`} disabled={props.resetDisabled?.(field, value)} onClick={() => store.props.onReset?.(field)}><RotateCcw  /></UiIconButton>}</div> : <UiFormRow label={field.title} info={field.tooltip} density="compact">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">{props.renderControl(field, value)}</div>
        {props.onReset && <UiIconButton size="2xs" className="shrink-0" aria-label={`重置${field.title}`} tooltip={`重置${field.title}`} disabled={props.resetDisabled?.(field, value)} onClick={() => store.props.onReset?.(field)}><RotateCcw  /></UiIconButton>}
      </div>
    </UiFormRow>}
    {wheel && <div className="min-w-0">{props.renderControl(field, value)}</div>}
    {field.animatable && (() => { const animation = props.renderAnimation?.(field, value); return isAnimationSlots(animation) ? <div className="flex items-center gap-1">{animation.leading}{animation.labelTrailing}</div> : animation })()}
  </div>
})

function FieldGroup({ title, fields, store }: { title: string; fields: readonly ParamFieldSpec[]; store: FieldStore }) {
  return useUiFieldLayout() === 'property' ? <PropertyFieldGroup title={title} fields={fields} store={store} /> : <FormFieldGroup title={title} fields={fields} store={store} />
}

/** 属性面板里的一行可折叠小标题，与参数行同一套四列（箭头在秒表列）。 */
function PropertyHeading({ label, name, open, onToggle }: { label: string; name: string; open: boolean; onToggle: () => void }) {
  const Chevron = open ? ChevronDown : ChevronRight
  return <div className="relative mx-1 grid h-control-sm grid-cols-property-row items-center gap-x-1 pr-2">
    <UiButton size="sm" className="absolute inset-0 w-full" aria-expanded={open} aria-label={name} onClick={onToggle} />
    <span aria-hidden="true" />
    <span aria-hidden="true" className="pointer-events-none relative flex justify-center text-text3"><Chevron size={UI_ICON_SIZE.sm} /></span>
    <span className="pointer-events-none relative min-w-0 truncate text-xs text-text2">{label}</span>
  </div>
}

/** 属性面板里的参数分组：没有标题的组直接是行；有标题的组先是一行可折叠的小标题。 */
function PropertyFieldGroup({ title, fields, store }: { title: string; fields: readonly ParamFieldSpec[]; store: FieldStore }) {
  const [open, setOpen] = useState(() => !title || !store.props.initiallyOpenGroups || store.props.initiallyOpenGroups.includes(title))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const basic = fields.filter(field => !field.advanced)
  const advanced = fields.filter(field => field.advanced)
  return <div className="flex flex-col">
    {title && <PropertyHeading label={title} name={`${open ? '收起' : '展开'}${title}`} open={open} onToggle={() => setOpen(value => !value)} />}
    {open && <>{basic.map(field => <FieldRow key={field.key} field={field} store={store} />)}
      {advanced.length > 0 && <PropertyHeading label="更多" name={title ? `${title}更多` : '更多'} open={advancedOpen} onToggle={() => setAdvancedOpen(value => !value)} />}
      {advancedOpen && advanced.map(field => <FieldRow key={field.key} field={field} store={store} />)}</>}
  </div>
}

function FormFieldGroup({ title, fields, store }: { title: string; fields: readonly ParamFieldSpec[]; store: FieldStore }) {
  const [open, setOpen] = useState(() => !title || !store.props.initiallyOpenGroups || store.props.initiallyOpenGroups.includes(title))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const basic = fields.filter(field => !field.advanced)
  const advanced = fields.filter(field => field.advanced)
  return <UiGroup titleTone="compact" gap="row" title={title ? <UiButton size="sm" className="-ml-2" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}${title}`} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown  /> : <ChevronRight  />}{title}</UiButton> : undefined}>
    {open && <>{basic.map(field => <FieldRow key={field.key} field={field} store={store} />)}{advanced.length > 0 && <UiGroup gap="row" titleTone="compact" title={<UiButton size="sm" className="-ml-2" aria-label={title ? `${title}更多` : '更多'} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(value => !value)}>{advancedOpen ? <ChevronDown  /> : <ChevronRight  />}更多</UiButton>}>{advancedOpen && advanced.map(field => <FieldRow key={field.key} field={field} store={store} />)}</UiGroup>}</>}
  </UiGroup>
}

export function ParamList(props: ParamListProps): React.ReactElement {
  // Adapters receive freshly cloned metadata. Preserve field identities across publications.
  const cache = useRef<{ signature: string; fields: readonly ParamFieldSpec[] }>()
  const signature = JSON.stringify(props.fields)
  if (cache.current?.signature !== signature) cache.current = { signature, fields: props.fields }
  const fields = cache.current.fields
  const [store] = useState(() => { const result = createFieldStore(); result.update(props, false); return result })
  useLayoutEffect(() => store.update(props, true))
  const groups = useMemo(() => {
    const result = new Map<string, ParamFieldSpec[]>([['', []]])
    for (const field of fields) { const name = field.group ?? ''; const group = result.get(name) ?? []; group.push(field); result.set(name, group) }
    return [...result].filter(([, group]) => group.length)
  }, [fields])
  const content = groups.map(([title, group]) => <FieldGroup key={title} title={title} fields={group} store={store} />)
  return useUiFieldLayout() === 'property' ? <div className="flex flex-col">{content}</div> : <UiGroup labelWidth={96} gap="row">{content}</UiGroup>
}
