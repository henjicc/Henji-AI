import { useEffect } from 'react'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import type { GenerationInputPanelPlacement } from '../inputPanelPlacement'

export function GenerationAppMenus({ onSearch, onClear, hasTasks, inputPanelPlacement, onToggleInputPanelPlacement }: {
  onSearch: () => void
  onClear: () => void
  hasTasks: boolean
  inputPanelPlacement: GenerationInputPanelPlacement
  onToggleInputPanelPlacement: () => void
}): null {
  const visible = useAppMenuVisibility()
  useEffect(() => visible ? contributeAppMenus('generation', [{ menu: 'generation', label: '生成', order: 100, items: [
    { kind: 'action', id: 'generation.search', label: '查找生成记录', run: onSearch },
    { kind: 'action', id: 'generation.clear', label: '清理生成记录…', disabledReason: hasTasks ? undefined : '还没有生成记录', run: onClear },
    { kind: 'separator' },
    { kind: 'action', id: 'generation.inputPanelPlacement', label: inputPanelPlacement === 'left' ? '把输入面板放到底部' : '把输入面板放到左侧', run: onToggleInputPanelPlacement },
  ] }]) : undefined, [visible, onSearch, onClear, hasTasks, inputPanelPlacement, onToggleInputPanelPlacement])
  return null
}
