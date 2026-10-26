import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { UiButton, UiEmpty, UiOptionButton, UiSearchInput } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { audioEditEffectCatalog, filterAudioEditEffectCatalog, AUDIO_EDIT_EFFECT_FOLDER_NAMES, type AudioEditEffectCatalogEntry, type AudioEditEffectFolder } from '@/core/audioEdit/effectCatalog'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'
import { AUDIO_EDIT_EFFECT_DRAG_TYPE, insertAudioEditEffect } from './audioEditEffectInsert'

const FOLDERS: AudioEditEffectFolder[] = ['smart', 'builtin', 'plugin']

/**
 * “效果”面板（对齐剪辑的效果面板）：可搜索的效果目录——智能修复、内置效果（按分类）、第三方插件（按厂商）。
 * 双击加到效果控件里选中项的下面，也可以拖到效果控件里的任意位置。
 */
export function AudioEditEffectLibrary(): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const catalog = useMemo(() => audioEditEffectCatalog(workspace.processors), [workspace.processors])
  const matching = useMemo(() => filterAudioEditEffectCatalog(catalog, query), [catalog, query])
  const searching = query.trim().length > 0
  const toggle = (key: string): void => setCollapsed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const heading = (key: string, label: string, depth: number, count: number) => {
    const open = searching || !collapsed.has(key)
    const Chevron = open ? ChevronDown : ChevronRight
    return <UiButton size="sm" className="w-full justify-start" aria-expanded={open} onClick={() => toggle(key)}>
      <Chevron size={UI_ICON_SIZE.sm} className="shrink-0 text-text3" /><span className={depth ? 'text-xs text-text2' : 'text-xs font-semibold text-text1'}>{label}</span><span className="ml-auto text-2xs tabular-nums text-text3">{count}</span>
    </UiButton>
  }
  const entry = (item: AudioEditEffectCatalogEntry) => <UiOptionButton key={item.key} variant="menu" size="sm" className="w-full" draggable={!item.disabledReason}
    disabled={workspace.disabled || Boolean(item.disabledReason)} disabledReason={item.disabledReason ?? '正在处理，请稍候'} tooltip={item.tooltip}
    onDragStart={event => { event.dataTransfer.setData(AUDIO_EDIT_EFFECT_DRAG_TYPE, item.key); event.dataTransfer.effectAllowed = 'copy' }}
    onDoubleClick={() => insertAudioEditEffect(workspace, item)}>{item.name}</UiOptionButton>
  return <div className="flex h-full min-h-0 flex-col bg-panel" data-audio-edit-panel="library">
    <div className="shrink-0 px-2 pb-1 pt-2"><UiSearchInput size="sm" aria-label="搜索效果" placeholder="搜索效果" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} /></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3" role="tree" aria-label="效果目录">
      {matching.length === 0 && <UiEmpty size="node" title={`没有找到“${query.trim()}”相关的效果`} />}
      {FOLDERS.map(folder => {
        const items = matching.filter(item => item.folder === folder)
        if (!items.length) return null
        const open = searching || !collapsed.has(folder)
        const groups = [...new Map(items.map(item => [item.group, item.groupName])).entries()]
        return <div key={folder} role="group" aria-label={AUDIO_EDIT_EFFECT_FOLDER_NAMES[folder]} className="flex flex-col">
          {heading(folder, AUDIO_EDIT_EFFECT_FOLDER_NAMES[folder], 0, items.length)}
          {open && groups.map(([group, name]) => {
            const members = items.filter(item => item.group === group)
            const key = `${folder}:${group}`
            // 缩进由外层容器给（分组在文件夹下、效果在分组下），按钮本身不改内边距
            return <div key={key} role="group" aria-label={name} className="flex flex-col pl-3">
              {heading(key, name, 1, members.length)}
              {(searching || !collapsed.has(key)) && <div className="flex flex-col pl-4">{members.map(entry)}</div>}
            </div>
          })}
        </div>
      })}
      {!searching && <p className="m-0 px-2 pt-2 text-2xs text-text3">双击加到效果控件，或拖到效果控件里的位置。</p>}
    </div>
  </div>
}
