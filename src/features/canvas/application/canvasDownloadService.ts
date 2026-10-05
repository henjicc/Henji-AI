import type { CanvasDownloadDestination } from '@/core/application-control/domains/canvas/canvasExportApplicationCapabilities'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { findCanvasProjectInstance } from './canvasProjectInstances'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  QUICK_DOWNLOAD_SETTING_SPECS,
  readLocalStorageSettings,
} from '@/hooks/useLocalStorageSetting'
import {
  downloadCanvasMediaTargetsToDirectory,
  resolveNodeDownloadTargets,
} from './canvasMediaDownload'

async function loadProjectNodes(projectId: string) {
  if (useProjectStore.getState().currentProject?.id === projectId) {
    return useCanvasStore.getState().nodes
  }
  const instance = findCanvasProjectInstance(projectId)
  if (instance) return instance.store.getState().nodes
  return (await readPersistedCanvasProjectSnapshot(projectId)).nodes
}

export function resolveConfiguredDestination(destination: CanvasDownloadDestination): string {
  if (destination.mode === 'quick') {
    const settings = readLocalStorageSettings(QUICK_DOWNLOAD_SETTING_SPECS)
    const targetDir = settings.quickDownloadPath.trim()
    if (!settings.enableQuickDownload || !targetDir) {
      throw new Error('QUICK_DOWNLOAD_NOT_CONFIGURED')
    }
    return targetDir
  }

  const targetDir = useSettingsStore.getState().downloadPresetPaths[destination.presetIndex]?.trim()
  if (!targetDir) throw new Error('DOWNLOAD_PRESET_NOT_FOUND')
  return targetDir
}

export async function downloadCanvasMedia(input: {
  projectId: string
  nodeIds: string[]
  destination: CanvasDownloadDestination
}): Promise<Record<string, unknown>> {
  const nodes = await loadProjectNodes(input.projectId)
  const requestedIds = new Set(input.nodeIds)
  const targets = resolveNodeDownloadTargets(nodes.filter((node) => requestedIds.has(node.id)))
  if (targets.length === 0) throw new Error('NO_DOWNLOADABLE_CANVAS_MEDIA')

  const summary = await downloadCanvasMediaTargetsToDirectory(
    targets,
    resolveConfiguredDestination(input.destination),
    input.destination.mode
  )
  if (summary.savedNodeIds.length === 0) throw new Error('CANVAS_MEDIA_DOWNLOAD_FAILED')

  return {
    projectId: input.projectId,
    ...summary,
    destinationMode: input.destination.mode,
  }
}
