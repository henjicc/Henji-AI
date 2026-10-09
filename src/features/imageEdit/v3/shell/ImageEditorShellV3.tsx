import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockviewApi } from 'dockview-react'

import type { ImageEditorV3Controller } from '../editor/types'
import shellPanels from '../panelEntries/shell'
import historyPanels from '../panelEntries/history'
import { ImageEditorPanelRegistryV3, type ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry'
import { createImageEditorMemoryLayoutStoreV3, resetImageEditorDockLayoutV3, type ImageEditorLayoutStoreV3 } from '../panelFramework/layout'
import { ImageEditorDockV3 } from './ImageEditorDockV3'
import { ImageEditorPanelMenuV3 } from './ImageEditorDockChromeV3'
import { ImageEditorShellContextV3 } from './ImageEditorShellContextV3'

// 每个面板任务只需新增自己的登记条目；不再改中央 union/switch/内容分派。
const entries = import.meta.glob<readonly ImageEditorPanelDefinitionV3[]>(['../panelEntries/*.{ts,tsx}', '!../panelEntries/shell.tsx', '!../panelEntries/history.tsx'], { eager: true, import: 'default' })
const defaultRegistry = new ImageEditorPanelRegistryV3([...shellPanels, ...historyPanels, ...Object.values(entries).flat()])

export function ImageEditorShellV3({ controller, commandBar, toolRail, preview, registry = defaultRegistry, layoutStore, onDockApiChange }: {
  controller: ImageEditorV3Controller
  commandBar: (panelActions: ReactNode) => ReactNode
  toolRail: ReactNode
  preview: ReactNode
  registry?: ImageEditorPanelRegistryV3
  layoutStore?: ImageEditorLayoutStoreV3
  onDockApiChange?: (api: DockviewApi | null) => void
}): JSX.Element {
  const { t } = useTranslation('ui')
  const memoryStore = useRef<ImageEditorLayoutStoreV3>()
  memoryStore.current ??= createImageEditorMemoryLayoutStoreV3()
  const panels = useMemo(() => registry.list(controller.profile), [registry, controller.profile])
  const [api, setApi] = useState<DockviewApi | null>(null)
  const onApiChangeRef = useRef(onDockApiChange)
  onApiChangeRef.current = onDockApiChange
  const acceptApi = useCallback((value: DockviewApi | null): void => {
    setApi(value)
    onApiChangeRef.current?.(value)
  }, [])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const restoreCollapsed = useCallback((ids: readonly string[]): void => setCollapsed(new Set(ids)), [])
  const toggleCollapsed = useCallback((id: string): void => setCollapsed(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])
  const restoreDefault = useCallback((): void => {
    if (!api) return
    setCollapsed(new Set())
    resetImageEditorDockLayoutV3(api, panels, definition => t(definition.titleKey, { defaultValue: definition.title }))
  }, [api, panels, t])
  return <ImageEditorShellContextV3.Provider value={{ controller, preview, panels, api, collapsed, toggleCollapsed, restoreDefault }}>
    {commandBar(<ImageEditorPanelMenuV3 />)}
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {toolRail}
      <ImageEditorDockV3 key={controller.profile.id} layoutStore={layoutStore ?? memoryStore.current}
        onApiChange={acceptApi} onRestoreCollapsed={restoreCollapsed} />
    </div>
  </ImageEditorShellContextV3.Provider>
}
