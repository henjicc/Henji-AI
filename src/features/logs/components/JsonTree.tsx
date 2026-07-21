import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton } from '@/components/ui'

/** 超过该长度的字符串默认收起，点击展开查看完整内容。 */
const LONG_STRING_THRESHOLD = 200
/** 默认展开的层级深度：根节点及其直接子节点展开，更深层级默认折叠。 */
const DEFAULT_EXPAND_DEPTH = 1

interface JsonTreeProps {
  value: DynamicValue
  /** 根节点标签，省略则不显示（用于顶层无名对象/数组）。 */
  label?: string
  /** 默认展开的层级深度，默认 1（根节点展开一层）。 */
  defaultExpandDepth?: number
}

/**
 * 轻量 JSON 折叠树：按层级展开/折叠对象与数组，长字符串默认收起、点击展开。
 * 自实现，不依赖任何第三方 JSON 视图库（见 CLAUDE.md 与任务文件约束）。
 */
export function JsonTree({ value, label, defaultExpandDepth = DEFAULT_EXPAND_DEPTH }: JsonTreeProps): JSX.Element {
  return <JsonNode label={label} value={value} depth={0} expandDepth={defaultExpandDepth} />
}

interface JsonNodeProps {
  label?: string
  value: DynamicValue
  depth: number
  expandDepth: number
}

function isContainer(value: DynamicValue): boolean {
  return value !== null && typeof value === 'object'
}

function JsonNode({ label, value, depth, expandDepth }: JsonNodeProps): JSX.Element {
  if (isContainer(value)) {
    return <JsonContainerNode label={label} value={value} depth={depth} expandDepth={expandDepth} />
  }
  return <JsonLeafNode label={label} value={value} />
}

function JsonContainerNode({ label, value, depth, expandDepth }: JsonNodeProps): JSX.Element {
  const isArray = Array.isArray(value)
  const entries: Array<[string, DynamicValue]> = isArray
    ? (value as DynamicValue[]).map((item, index) => [String(index), item])
    : Object.entries(value as DynamicValueMap)
  const [expanded, setExpanded] = useState(depth < expandDepth)

  if (entries.length === 0) {
    return (
      <div className="py-0.5 pl-1 font-mono text-[11px] text-text-muted">
        {label !== undefined && <span className="text-brand-300">{label}: </span>}
        <span>{isArray ? '[]' : '{}'}</span>
      </div>
    )
  }

  return (
    <div>
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start gap-1 rounded px-1 py-0.5 text-left font-mono text-[11px] font-normal"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {label !== undefined && <span className="text-brand-300">{label}:</span>}
        <span className="text-text-muted">{isArray ? `Array(${entries.length})` : `Object{${entries.length}}`}</span>
      </UiButton>
      {expanded && (
        <div className="ml-2 border-l border-border-dark/40 pl-2">
          {entries.map(([key, item]) => (
            <JsonNode key={key} label={isArray ? undefined : key} value={item} depth={depth + 1} expandDepth={expandDepth} />
          ))}
        </div>
      )}
    </div>
  )
}

interface JsonLeafNodeProps {
  label?: string
  value: DynamicValue
}

function JsonLeafNode({ label, value }: JsonLeafNodeProps): JSX.Element {
  const { t } = useI18n('ui')
  const [stringExpanded, setStringExpanded] = useState(false)

  if (typeof value === 'string') {
    const isLong = value.length > LONG_STRING_THRESHOLD
    const display = isLong && !stringExpanded ? `${value.slice(0, LONG_STRING_THRESHOLD)}…` : value

    return (
      <div className="py-0.5 pl-1 font-mono text-[11px]">
        {label !== undefined && <span className="text-brand-300">{label}: </span>}
        <span className="whitespace-pre-wrap break-all text-emerald-400">&quot;{display}&quot;</span>
        {isLong && (
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            className="ml-1 h-auto rounded px-1 py-0 text-[10px] font-normal text-brand-300"
            onClick={() => setStringExpanded((current) => !current)}
          >
            {stringExpanded
              ? t('logsWindow.detail.jsonTree.collapseString')
              : t('logsWindow.detail.jsonTree.expandString', { count: value.length })}
          </UiButton>
        )}
      </div>
    )
  }

  const display = value === null ? 'null' : value === undefined ? 'undefined' : String(value)
  const valueColorClass =
    typeof value === 'number' ? 'text-sky-400' : typeof value === 'boolean' ? 'text-amber-400' : 'text-text-muted'

  return (
    <div className="py-0.5 pl-1 font-mono text-[11px]">
      {label !== undefined && <span className="text-brand-300">{label}: </span>}
      <span className={valueColorClass}>{display}</span>
    </div>
  )
}
