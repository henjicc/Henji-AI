import { memo, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { UiButton, UiGroup, UiIconButton, UiTooltipText } from '@/components/ui'
import type { CodeParameterValue } from '@/core/videoEdit/codeMaterial/contract'
import type { ParamFieldSpec } from './fieldSpec'

export interface ParamListProps {
  fields: readonly ParamFieldSpec[]
  values: Readonly<Record<string, CodeParameterValue>>
  /** Per-field animation data is subscribed alongside that field's value. */
  extras?: Readonly<Record<string, unknown>>
  contextKey?: string
  renderControl: (field: ParamFieldSpec, value: CodeParameterValue) => ReactNode
  renderAnimation?: (field: ParamFieldSpec, value: CodeParameterValue) => ReactNode
  onReset?: (field: ParamFieldSpec) => void
  resetDisabled?: (field: ParamFieldSpec, value: CodeParameterValue) => boolean
  highlightedKeys?: readonly string[]
}
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
  const [value, , visible, , highlighted] = JSON.parse(snapshot) as [CodeParameterValue, unknown, boolean, string, boolean]
  if (!visible) return null
  const props = store.props
  return <div className={highlighted ? 'flex flex-col gap-1 bg-selected-accent' : 'flex flex-col gap-1'} data-video-edit-code-parameter={field.source === 'code' ? field.key : undefined} data-video-edit-builtin-param={field.source === 'builtin' ? field.key : undefined} data-code-element-parameter={highlighted || undefined}>
    <div className="flex min-h-8 items-start gap-1.5">
      <span className="w-24 shrink-0 pt-1 text-xs text-text2"><UiTooltipText tooltip={field.tooltip}>{field.title}</UiTooltipText></span>
      <div className="min-w-0 flex-1">{props.renderControl(field, value)}</div>
      {props.onReset && <UiIconButton size="xs" aria-label={`重置${field.title}`} title={`重置${field.title}`} disabled={props.resetDisabled?.(field, value)} onClick={() => store.props.onReset?.(field)}><RotateCcw size={12} /></UiIconButton>}
    </div>
    {field.animatable && props.renderAnimation?.(field, value)}
  </div>
})

function FieldGroup({ title, fields, store }: { title: string; fields: readonly ParamFieldSpec[]; store: FieldStore }) {
  const [open, setOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const basic = fields.filter(field => !field.advanced)
  const advanced = fields.filter(field => field.advanced)
  return <UiGroup titleTone="compact" gap="row" title={title ? <UiButton size="sm" className="-ml-2 gap-1" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}${title}`} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{title}</UiButton> : undefined}>
    {open && <>{basic.map(field => <FieldRow key={field.key} field={field} store={store} />)}{advanced.length > 0 && <UiGroup gap="row" titleTone="compact" title={<UiButton size="sm" className="-ml-2 gap-1" aria-label={title ? `${title}更多` : '更多'} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(value => !value)}>{advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}更多</UiButton>}>{advancedOpen && advanced.map(field => <FieldRow key={field.key} field={field} store={store} />)}</UiGroup>}</>}
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
  return <div className="flex flex-col gap-2">{groups.map(([title, group]) => <FieldGroup key={title} title={title} fields={group} store={store} />)}</div>
}
