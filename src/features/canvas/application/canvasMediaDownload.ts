import { createLogger } from '@/core/logging'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry'
import { resolveLocalAssetPath } from '@/features/assets/services/assetCollectionService'
import { saveImageSourceToDirectory, saveImageSourceToPath } from '@/commands/image'
import { saveDialog } from '@/platform/desktopApi'
import {
  downloadMediaFile,
  quickDownloadMediaFile,
  saveAudioFromUrl,
  saveVideoFromUrl,
} from '@/utils/save'

const logger = createLogger('features.canvas.application.canvasMediaDownload')

export type CanvasMediaDownloadMode = 'save_as' | 'quick' | 'preset' | 'folder'

export interface CanvasMediaDownloadTarget {
  nodeId: string
  mediaType: 'image' | 'video' | 'audio'
  source: string
  suggestedFileName: string
}

export interface CanvasMediaDownloadSummary {
  requestedCount: number
  savedNodeIds: string[]
  failedNodeIds: string[]
}

function getFileExtension(sourcePath: string): string {
  const cleanPath = sourcePath.split(/[?#]/, 1)[0]
  return cleanPath.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? ''
}

export function resolveNodeDownloadTarget(node: CanvasNode): CanvasMediaDownloadTarget | null {
  const definition = getNodeDefinition(node.type)
  if (!definition.capabilities.toolbarDownload) {
    return null
  }

  const output = definition.getOutputs?.(node.data)[0]
  if (definition.media?.kind === 'image') {
    const previewSource = typeof node.data.previewImageUrl === 'string'
      ? node.data.previewImageUrl
      : null
    const source = output?.kind === 'image' ? output.url : previewSource
    return source
      ? { nodeId: node.id, mediaType: 'image', source, suggestedFileName: `node-${node.id}.png` }
      : null
  }

  if (!output?.url || (output.kind !== 'video' && output.kind !== 'audio')) {
    return null
  }

  const source = resolveLocalAssetPath(output.url)
    ?? (/^https?:\/\//i.test(output.url) ? output.url : null)
  if (!source) {
    return null
  }

  const fallbackExtension = output.kind === 'video' ? 'mp4' : 'mp3'
  const extension = getFileExtension(source) || fallbackExtension
  return {
    nodeId: node.id,
    mediaType: output.kind,
    source,
    suggestedFileName: `node-${node.id}.${extension}`,
  }
}

export function resolveNodeDownloadTargets(nodes: readonly CanvasNode[]): CanvasMediaDownloadTarget[] {
  return nodes.flatMap((node) => {
    const target = resolveNodeDownloadTarget(node)
    return target ? [target] : []
  })
}

async function resolveMediaFileSource(target: CanvasMediaDownloadTarget): Promise<string> {
  if (target.mediaType === 'image' || !/^https?:\/\//i.test(target.source)) {
    return target.source
  }
  const saved = target.mediaType === 'video'
    ? await saveVideoFromUrl(target.source)
    : await saveAudioFromUrl(target.source)
  return saved.fullPath
}

export async function saveCanvasMediaTargetAs(
  target: CanvasMediaDownloadTarget
): Promise<string | null> {
  logger.info('画布媒体另存为开始', {
    event: 'canvas.media_download.start',
    nodeId: target.nodeId,
    mediaType: target.mediaType,
    mode: 'save_as',
  })

  try {
    let savedPath: string | null
    if (target.mediaType === 'image') {
      const selectedPath = await saveDialog({ defaultPath: target.suggestedFileName })
      savedPath = selectedPath
        ? await saveImageSourceToPath(target.source, selectedPath)
        : null
    } else {
      const sourcePath = await resolveMediaFileSource(target)
      savedPath = await downloadMediaFile(sourcePath, target.suggestedFileName)
    }

    if (savedPath) {
      logger.info('画布媒体另存为完成', {
        event: 'canvas.media_download.completed',
        nodeId: target.nodeId,
        mediaType: target.mediaType,
        mode: 'save_as',
      })
    }
    return savedPath
  } catch (error) {
    if (error instanceof Error && error.message === 'cancelled') {
      return null
    }
    logger.error('画布媒体另存为失败', error, {
      event: 'canvas.media_download.failed',
      context: { nodeId: target.nodeId, mediaType: target.mediaType, mode: 'save_as' },
    })
    throw error
  }
}

async function saveTargetToDirectory(
  target: CanvasMediaDownloadTarget,
  targetDir: string
): Promise<void> {
  if (target.mediaType === 'image') {
    await saveImageSourceToDirectory(
      target.source,
      targetDir,
      target.suggestedFileName.replace(/\.png$/i, '')
    )
    return
  }

  await quickDownloadMediaFile(
    await resolveMediaFileSource(target),
    targetDir,
    target.suggestedFileName
  )
}

export async function downloadCanvasMediaTargetsToDirectory(
  targets: readonly CanvasMediaDownloadTarget[],
  targetDir: string,
  mode: Exclude<CanvasMediaDownloadMode, 'save_as'>
): Promise<CanvasMediaDownloadSummary> {
  logger.info('画布媒体批量下载开始', {
    event: 'canvas.media_batch_download.start',
    requestedCount: targets.length,
    mode,
    nodeIds: targets.map((target) => target.nodeId),
  })

  const savedNodeIds: string[] = []
  const failedNodeIds: string[] = []
  for (const target of targets) {
    try {
      await saveTargetToDirectory(target, targetDir)
      savedNodeIds.push(target.nodeId)
    } catch (error) {
      failedNodeIds.push(target.nodeId)
      logger.error('画布媒体批量下载单项失败', error, {
        event: 'canvas.media_batch_download.item_failed',
        context: { nodeId: target.nodeId, mediaType: target.mediaType, mode },
      })
    }
  }

  const summary = { requestedCount: targets.length, savedNodeIds, failedNodeIds }
  logger.info('画布媒体批量下载完成', {
    event: 'canvas.media_batch_download.completed',
    requestedCount: targets.length,
    savedCount: savedNodeIds.length,
    failedCount: failedNodeIds.length,
    mode,
  })
  return summary
}
