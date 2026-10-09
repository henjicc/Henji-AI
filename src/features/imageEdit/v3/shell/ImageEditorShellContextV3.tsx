import { createContext, useContext, type ReactNode } from 'react'
import type { DockviewApi } from 'dockview-react'

import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry'
import type { ImageEditorV3Controller } from '../editor/types'

export interface ImageEditorShellContextV3 {
  controller: ImageEditorV3Controller
  preview: ReactNode
  panels: readonly ImageEditorPanelDefinitionV3[]
  api: DockviewApi | null
  collapsed: ReadonlySet<string>
  toggleCollapsed: (id: string) => void
  restoreDefault: () => void
}

export const ImageEditorShellContextV3 = createContext<ImageEditorShellContextV3 | null>(null)

export function useImageEditorShellV3(): ImageEditorShellContextV3 {
  const value = useContext(ImageEditorShellContextV3)
  if (!value) throw new Error('图片面板宿主尚未就绪')
  return value
}
