import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import * as icons from '@/core/theme/icons'
import { TOOL_DESCRIPTORS, type ToolDescriptor } from '@/core/toolbox/toolCatalog'

export interface ToolboxToolProps { onBack: () => void }
export interface ToolboxToolEntry {
  loadComponent: () => Promise<{ default: ComponentType<ToolboxToolProps> }>
  openRecentFile?: (documentId: string) => Promise<void>
  currentDocumentName?: () => string | undefined
}
export interface ToolboxRuntimeTool<T extends ToolDescriptor = ToolDescriptor> {
  descriptor: T
  icon: LucideIcon
  component: LazyExoticComponent<ComponentType<ToolboxToolProps>>
  openRecentFile?: ToolboxToolEntry['openRecentFile']
  currentDocumentName?: ToolboxToolEntry['currentDocumentName']
}

/** Vite 只收集轻量入口；入口里的编辑器和文档打开器仍按需 import。 */
const entries = import.meta.glob<{ default: ToolboxToolEntry }>('./toolboxTools/*/entry.ts', { eager: true })

export function createToolboxRuntime<const T extends readonly ToolDescriptor[]>(
  descriptors: T,
  modules: Readonly<Record<string, { default: ToolboxToolEntry }>> = entries,
): readonly ToolboxRuntimeTool<T[number]>[] {
  return descriptors.map((descriptor) => {
    const entry = modules[`./toolboxTools/${descriptor.entryId}/entry.ts`]?.default
    if (!entry) throw new Error(`工具 ${descriptor.id} 缺少渲染入口 ${descriptor.entryId}`)
    if (descriptor.recentFiles && !entry.openRecentFile) throw new Error(`工具 ${descriptor.id} 缺少最近文件打开器`)
    const icon = (icons as Readonly<Record<string, LucideIcon>>)[descriptor.icon]
    if (!icon) throw new Error(`工具 ${descriptor.id} 缺少图标登记 ${descriptor.icon}`)
    return { descriptor, icon, component: lazy(entry.loadComponent), openRecentFile: entry.openRecentFile, currentDocumentName: entry.currentDocumentName }
  })
}

export const TOOLBOX_RUNTIME = createToolboxRuntime(TOOL_DESCRIPTORS)
