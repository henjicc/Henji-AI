import { ChevronRight, Minus, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'

import {
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiIconButton,
  UiInput,
  UiModal,
  UiOptionButton,
} from '@/components/ui'

export interface DiscoveredModelOption {
  modelId: string
  displayName: string
}

interface ModelSyncDialogProps {
  open: boolean
  providerName: string
  /** 远端返回的全部模型。 */
  discovered: DiscoveredModelOption[]
  /** 本地已添加的 modelId。 */
  addedModelIds: ReadonlySet<string>
  onClose: () => void
  onAdd: (modelIds: string[]) => void | Promise<void>
  onRemove: (modelIds: string[]) => void | Promise<void>
}

type Row =
  | { key: string; kind: 'group'; group: string; models: DiscoveredModelOption[]; collapsed: boolean }
  | { key: string; kind: 'model'; model: DiscoveredModelOption }

/**
 * 厂商前缀：`moonshotai/Kimi-K2.7-Code` → `moonshotai`。
 * 没有斜杠的（`deepseek-v4-flash`）归到「其他」，不硬拆——拆错比不拆更难认。
 */
function groupOf(modelId: string): string {
  const index = modelId.indexOf('/')
  return index > 0 ? modelId.slice(0, index) : '其他'
}

export function ModelSyncDialog({
  open,
  providerName,
  discovered,
  addedModelIds,
  onClose,
  onAdd,
  onRemove,
}: ModelSyncDialogProps) {
  const [keyword, setKeyword] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const normalized = keyword.trim().toLowerCase()
  const filtered = useMemo(() => (
    normalized
      ? discovered.filter(item => (
          item.modelId.toLowerCase().includes(normalized)
          || item.displayName.toLowerCase().includes(normalized)
        ))
      : discovered
  ), [discovered, normalized])

  const groups = useMemo(() => {
    const map = new Map<string, DiscoveredModelOption[]>()
    for (const model of filtered) {
      const group = groupOf(model.modelId)
      const list = map.get(group)
      if (list) list.push(model)
      else map.set(group, [model])
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [filtered])

  // 搜索时一律展开：搜到的东西藏在折叠组里等于没搜到。
  const rows = useMemo<Row[]>(() => groups.flatMap(([group, models]) => {
    const isCollapsed = !normalized && collapsed.has(group)
    const header: Row = { key: `g:${group}`, kind: 'group', group, models, collapsed: isCollapsed }
    if (isCollapsed) return [header]
    return [header, ...models.map((model): Row => ({ key: `m:${model.modelId}`, kind: 'model', model }))]
  }), [collapsed, groups, normalized])

  const toggleGroup = (group: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const addedCount = discovered.filter(item => addedModelIds.has(item.modelId)).length

  return (
    <UiModal
      isOpen={open}
      onClose={onClose}
      title={`${providerName} 模型`}
      size="form"
      footer={(
        <div className="flex items-center gap-3">
          <span className={UI_TEXT_META_CLASS}>
            已添加 {addedCount} / 共 {discovered.length}
          </span>
          <UiButton type="button" variant="primary" className="ml-auto" onClick={onClose}>完成</UiButton>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <UiInput
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索模型…"
            className="pl-9"
          />
        </div>

        {rows.length === 0
          ? (
            <UiEmpty
              title={normalized ? '没有匹配的模型' : '远端没有返回模型'}
              description={normalized ? '换个关键词试试。' : '确认密钥与接口地址是否正确。'}
            />
          )
          : (
            <Virtuoso
              style={{ height: 420 }}
              data={rows}
              computeItemKey={(_, row) => row.key}
              itemContent={(_, row) => {
                if (row.kind === 'group') {
                  const allAdded = row.models.every(item => addedModelIds.has(item.modelId))
                  return (
                    <div className="flex items-center gap-2">
                      <UiOptionButton
                        type="button"
                        variant="menu"
                        className="min-w-0 flex-1 gap-1.5"
                        aria-expanded={!row.collapsed}
                        onClick={() => toggleGroup(row.group)}
                      >
                        <ChevronRight
                          size={14}
                          className={`shrink-0 text-text-muted transition-transform ${row.collapsed ? '' : 'rotate-90'}`}
                        />
                        <span className={`truncate ${UI_TEXT_LABEL_CLASS}`}>{row.group}</span>
                        <span className={UI_TEXT_META_CLASS}>{row.models.length}</span>
                      </UiOptionButton>
                      <UiIconButton
                        type="button"
                        showBorder={false}
                        appearance="hover-only"
                        aria-label={allAdded ? `移除 ${row.group} 全部模型` : `添加 ${row.group} 全部模型`}
                        onClick={() => {
                          const ids = row.models.map(item => item.modelId)
                          if (allAdded) void onRemove(ids)
                          else void onAdd(ids.filter(id => !addedModelIds.has(id)))
                        }}
                      >
                        {allAdded ? <Minus size={15} /> : <Plus size={15} />}
                      </UiIconButton>
                    </div>
                  )
                }

                const added = addedModelIds.has(row.model.modelId)
                return (
                  <div className="flex items-center gap-2 rounded-lg py-1.5 pl-5 pr-1 transition-colors hover:bg-layer">
                    <div className="min-w-0 flex-1">
                      <div className={`truncate ${UI_TEXT_LABEL_CLASS}`}>{row.model.displayName}</div>
                      {row.model.displayName !== row.model.modelId && (
                        <div className={`truncate ${UI_TEXT_META_CLASS}`}>{row.model.modelId}</div>
                      )}
                    </div>
                    <UiIconButton
                      type="button"
                      showBorder={false}
                      appearance="hover-only"
                      aria-label={added ? `移除 ${row.model.modelId}` : `添加 ${row.model.modelId}`}
                      onClick={() => {
                        if (added) void onRemove([row.model.modelId])
                        else void onAdd([row.model.modelId])
                      }}
                    >
                      {added ? <Minus size={15} /> : <Plus size={15} />}
                    </UiIconButton>
                  </div>
                )
              }}
            />
          )}
      </div>
    </UiModal>
  )
}



