import { type SerializedDockview } from 'dockview-react'
import { registerWorkspaceLayout, type WorkspaceLayoutController } from '@/services/workspaceLayouts/workspaceLayoutService'
import { imageEditorDockPanelsV3, type ImageEditorPanelDefinitionV3 } from './panelRegistry'
import { defaultImageEditorLayout, validateImageEditorDockLayoutV3, type ImageEditorLayoutStoreV3 } from './layout'
import type { ImageEditorHostProfileIdV3 } from '../application/imageEditorHostProfiles'

export function registerImageEditorLayout(workspaceId: string, profileId: ImageEditorHostProfileIdV3, definitions: readonly ImageEditorPanelDefinitionV3[], legacy?: ImageEditorLayoutStoreV3): WorkspaceLayoutController {
  return registerWorkspaceLayout({
    workspaceId, panels: imageEditorDockPanelsV3(definitions),
    builtinPresets: [{ id: 'default', name: '默认', layout: defaultImageEditorLayout(definitions) }, { id: 'canvas', name: '专注画布', layout: defaultImageEditorLayout(definitions, true) }],
    validate: dock => validateImageEditorDockLayoutV3({ dock, collapsed: (dock as SerializedDockview & { collapsed?: string[] }).collapsed ?? [] }, definitions),
    readLegacy: () => {
      const saved = legacy?.load(profileId)
      if (saved === undefined) return undefined
      validateImageEditorDockLayoutV3(saved, definitions)
      return { ...saved.dock, collapsed: [...saved.collapsed] } as SerializedDockview
    },
  })
}
