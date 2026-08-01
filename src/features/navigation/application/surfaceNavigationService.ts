import { createLogger } from '@/core/logging'
import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import {
  closeAssetLibrary,
  openAssetLibrary,
  selectToolboxTool,
  switchWorkspace,
  useNavigationStore,
} from '@/stores/navigationStore'
import { openSettingsPanel, useUiStore } from '@/stores/uiStore'

import {
  getApplicationSurface,
  listApplicationSurfaces,
  type ApplicationSurfaceDefinition,
} from './surfaceCatalog'

export interface SurfaceNavigationCorrelation {
  requestId?: string
  taskId?: string
}

export interface SurfaceNavigationResult {
  surfaceId: string
  status: 'opened' | 'already_active' | 'closed'
  navigationRevision: number
}

const logger = createLogger('features.navigation.surface')

function settingsTargetMatches(
  current: SettingsNavigationTarget | null,
  expected: SettingsNavigationTarget
): boolean {
  return current?.tab === expected.tab
    && (current.sectionId ?? null) === (expected.sectionId ?? null)
}

export function isApplicationSurfaceActive(surface: ApplicationSurfaceDefinition): boolean {
  if (surface.settingsTarget) {
    const ui = useUiStore.getState()
    return ui.isSettingsOpen && settingsTargetMatches(ui.settingsTarget, surface.settingsTarget)
  }
  if (surface.id === 'overlay.assets') return useAssetLibraryStore.getState().view === 'floating'
  const navigation = useNavigationStore.getState()
  if (surface.toolId) {
    return navigation.activeWorkspace === surface.workspace && navigation.activeToolId === surface.toolId
  }
  return navigation.activeWorkspace === surface.workspace
}

export function describeApplicationSurface(surfaceId: string): {
  definition: ApplicationSurfaceDefinition
  available: boolean
  active: boolean
  reasons: string[]
} {
  const definition = getApplicationSurface(surfaceId)
  if (!definition) throw new Error('NOT_FOUND')
  return { definition, available: true, active: isApplicationSurfaceActive(definition), reasons: [] }
}

export function openApplicationSurface(
  surfaceId: string,
  correlation: SurfaceNavigationCorrelation = {}
): SurfaceNavigationResult {
  const surface = getApplicationSurface(surfaceId)
  if (!surface) throw new Error('NOT_FOUND')
  const beforeRevision = useNavigationStore.getState().revision
  if (isApplicationSurfaceActive(surface)) {
    return { surfaceId, status: 'already_active', navigationRevision: beforeRevision }
  }
  logger.info('应用 Surface 打开开始', {
    event: 'navigation.surface.open.start', ...correlation, surfaceId, openPolicy: surface.openPolicy,
  })
  try {
    if (surface.settingsTarget) {
      openSettingsPanel(surface.settingsTarget)
    } else if (surface.id === 'overlay.assets') {
      openAssetLibrary('floating')
    } else {
      if (surface.workspace) switchWorkspace(surface.workspace)
      if (surface.toolId) selectToolboxTool(surface.toolId)
    }
    if (!isApplicationSurfaceActive(surface)) throw new Error('SURFACE_NOT_OPEN')
    const result = {
      surfaceId,
      status: 'opened' as const,
      navigationRevision: useNavigationStore.getState().revision,
    }
    logger.info('应用 Surface 打开完成', {
      event: 'navigation.surface.open.completed', ...correlation, ...result,
    })
    return result
  } catch (error) {
    logger.error('应用 Surface 打开失败', error, {
      event: 'navigation.surface.open.failed', ...correlation, surfaceId,
    })
    throw error
  }
}

export function closeApplicationSurface(
  surfaceId?: string,
  correlation: SurfaceNavigationCorrelation = {}
): SurfaceNavigationResult {
  const target = surfaceId ? getApplicationSurface(surfaceId) : listApplicationSurfaces()
    .find((surface) => isApplicationSurfaceActive(surface))
  if (surfaceId && !target) throw new Error('NOT_FOUND')
  const targetId = target?.id ?? surfaceId ?? 'none'
  logger.info('应用 Surface 关闭开始', {
    event: 'navigation.surface.close.start', ...correlation, surfaceId: targetId,
  })
  try {
    if (targetId.startsWith('settings.')) {
      useUiStore.getState().closeSettings()
    } else if (targetId === 'overlay.assets' || targetId === 'workspace.assets') {
      closeAssetLibrary()
    } else if (targetId.startsWith('tool.')) {
      selectToolboxTool(null)
    }
    const result = {
      surfaceId: targetId,
      status: 'closed' as const,
      navigationRevision: useNavigationStore.getState().revision,
    }
    logger.info('应用 Surface 关闭完成', {
      event: 'navigation.surface.close.completed', ...correlation, ...result,
    })
    return result
  } catch (error) {
    logger.error('应用 Surface 关闭失败', error, {
      event: 'navigation.surface.close.failed', ...correlation, surfaceId: targetId,
    })
    throw error
  }
}
