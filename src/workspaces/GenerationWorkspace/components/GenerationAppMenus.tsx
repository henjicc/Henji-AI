import { useEffect } from 'react'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { contributeAppMenus } from '@/core/appMenu/appMenu'

export function GenerationAppMenus({ onSearch, onClear, hasTasks }: { onSearch: () => void; onClear: () => void; hasTasks: boolean }): null {
  const visible = useAppMenuVisibility()
  useEffect(() => visible ? contributeAppMenus('generation', [{ menu: 'generation', label: '生成', order: 100, items: [
    { kind: 'action', id: 'generation.search', label: '查找生成记录', run: onSearch },
    { kind: 'action', id: 'generation.clear', label: '清理生成记录…', disabledReason: hasTasks ? undefined : '还没有生成记录', run: onClear },
  ] }]) : undefined, [visible, onSearch, onClear, hasTasks])
  return null
}
