import { createLogger } from '@/core/logging'
import { videoEditComposition, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { VIDEO_EDIT_EXPORT_PRESETS, patchVideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import type { CanvasNodePlacement } from '@/core/application-control/domains/canvas/canvasMutationApplicationCapabilities'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { addAssetToCanvas } from '@/features/assets/application/assetCanvasApplicationService'
import { findCanvasProjectInstance, getCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { createCanvasMutationCheckpoint } from '@/features/canvas/application/canvasPersistenceService'
import { observeVideoEditFrame } from '@/features/videoEdit/application/videoEditFrameObservation'
import { exportVideoEdit, videoEditExportTask } from '@/features/videoEdit/application/videoEditExport'
import { collectVideoEditOutput } from '@/features/videoEdit/application/videoEditOutputs'
import { sameVideoEditAssetContent } from '@/features/videoEdit/application/videoEditAssetReferences'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { requireVideoEditInstance, type VideoEditInstance } from '@/features/videoEdit/application/videoEditService'

const logger = createLogger('services.workspaceTransfer')
export type VideoEditCanvasSource = { kind: 'frame'; frame: number } | { kind: 'clip'; clipId: string }
export interface VideoEditCanvasTransfer {
  projectId: string
  sequenceId: string
  canvasId: string
  source: VideoEditCanvasSource
  placement?: CanvasNodePlacement
}
export interface WorkspaceCanvasReceipt {
  undoRef: string
  nodeRef: { kind: 'canvas.node'; id: string }
  assetRef: { kind: 'asset'; id: string }
  verification: { verified: boolean; condition: string }
}

/** Export the selected picture and its linked sound, retaining source trim, speed, effects and animation. */
export function videoEditClipTransferSnapshot(document: VideoEditDocument, sequenceId: string, clipId: string): { snapshot: VideoEditComposition; range: { startFrame: number; endFrame: number }; kind: 'image' | 'video' | 'audio' } {
  const sequence = videoEditComposition(document, sequenceId)
  const clip = sequence.clips.find(value => value.id === clipId)
  if (!clip || clip.kind === 'adjustment' || clip.kind === 'sequence') throw new Error('请选择独立的图片、视频、声音或图文片段；调整图层和嵌套序列请先导出成片。')
  const clips = sequence.clips.filter(value => value.id === clip.id || clip.kind !== 'audio' && Boolean(clip.linkId) && value.linkId === clip.linkId && (value.kind === 'audio' || value.sourceComponent === 'audio'))
  const ids = new Set(clips.map(value => value.id))
  if (clips.some(value => value.follow && !ids.has(value.follow.clipId))) throw new Error('片段跟随了其他片段，请先导出该范围的合成画面再发送。')
  const kind = clip.kind === 'audio' || clip.sourceComponent === 'audio' ? 'audio' : ['image', 'text', 'graphic'].includes(clip.kind) ? 'image' : 'video'
  const snapshot = structuredClone({ ...sequence, clips,
    tracks: sequence.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })),
    annotations: sequence.annotations.filter(value => ids.has(value.clipId)),
    captions: (sequence.captions ?? []).filter(value => Boolean(value.clipId) && ids.has(value.clipId!)),
    transitions: (sequence.transitions ?? []).filter(value => (!value.leftClipId || ids.has(value.leftClipId)) && (!value.rightClipId || ids.has(value.rightClipId))),
  })
  return { snapshot, kind, range: { startFrame: clip.start, endFrame: clip.start + clip.duration } }
}

const outputs = new WeakMap<VideoEditDocument, Map<string, AssetRecord>>()
async function outputFolder(owner: VideoEditInstance): Promise<string> {
  const platform = getPlatform(); const container = owner.session.documentMeta.container
  if (container.kind === 'project') {
    const project = await getDocumentOperations().findProject(container.projectId)
    return platform.system.paths.join(project.path, project.folders.generated)
  }
  return (await platform.system.paths.appDirectories()).folders.generated
}

/** Cross-domain orchestration only: pixels, files, assets and canvas history keep their existing owners. */
export async function sendVideoEditToCanvas(input: VideoEditCanvasTransfer, signal: AbortSignal = new AbortController().signal): Promise<WorkspaceCanvasReceipt> {
  const owner = requireVideoEditInstance(input.projectId); const baseline = owner.document
  videoEditComposition(baseline, input.sequenceId)
  const canvas = await getCanvasProjectInstance(input.canvasId)
  const checkpoint = createCanvasMutationCheckpoint(canvas.id)
  const assertSource = (): void => {
    signal.throwIfAborted()
    if (requireVideoEditInstance(input.projectId) !== owner || owner.document !== baseline) throw new Error('原剪辑已修改或关闭，已生成的媒体保留，请重新发送。')
    if (findCanvasProjectInstance(canvas.id) !== canvas || canvas.closing || canvas.session.isEnded) throw new Error('原目标画布已关闭，请重新选择画布。')
  }
  logger.info('开始发送剪辑内容到画布', { event: 'workspace_transfer.video_edit_canvas.start', context: { projectId: input.projectId, canvasId: canvas.id, source: input.source.kind } })
  try {
    assertSource()
    const key = JSON.stringify([input.sequenceId, input.source])
    let cache = outputs.get(baseline)
    if (!cache) { cache = new Map(); outputs.set(baseline, cache) }
    let asset = cache.get(key)
    if (asset && !sameVideoEditAssetContent(asset, await assetApplicationService.inspect(asset.id))) {
      cache.delete(key)
      throw new Error('已生成媒体的内容已改变，请再次发送以重新取帧或导出。')
    }
    if (!asset) {
      if (input.source.kind === 'frame') asset = (await observeVideoEditFrame(input.projectId, { kind: 'program', sequenceId: input.sequenceId, frame: input.source.frame }, null, signal)).asset
      else {
        const prepared = videoEditClipTransferSnapshot(baseline, input.sequenceId, input.source.clipId)
        if (prepared.kind === 'image') asset = (await observeVideoEditFrame(input.projectId, { kind: 'program', sequenceId: input.sequenceId, frame: prepared.range.startFrame }, null, signal, prepared.snapshot)).asset
        else {
          const platform = getPlatform(); const folder = await outputFolder(owner)
          assertSource(); await platform.system.fs.mkdir(folder, { recursive: true }); assertSource()
          const path = await platform.system.paths.join(folder, `clip-${crypto.randomUUID()}.${prepared.kind === 'audio' ? 'wav' : 'mp4'}`)
          const settings = patchVideoEditExportSettings(VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:master')!.settings, { format: prepared.kind === 'audio' ? 'wav' : 'mp4', width: prepared.snapshot.width, height: prepared.snapshot.height, addToLibrary: false, captionMode: prepared.kind === 'audio' ? 'none' : 'burn' })
          assertSource()
          const exported = await exportVideoEdit(input.projectId, path, false, signal, undefined, { ...prepared, settings, signal })
          assertSource()
          const output = videoEditExportTask(input.projectId)?.output
          if (!exported || !output || output.path !== path) throw new Error('片段导出未完成，画布没有新增节点。')
          asset = await collectVideoEditOutput(output, {}, signal)
        }
      }
      cache.set(key, asset)
    }
    assertSource()
    const result = await addAssetToCanvas({ projectId: canvas.id, assetId: asset.id, placement: input.placement ?? { mode: 'viewport_center' } }, signal, { checkpoint })
    const nodeRef = result.nodeRef as WorkspaceCanvasReceipt['nodeRef']
    const verification = result.verification as WorkspaceCanvasReceipt['verification']
    logger.info('剪辑内容已发送到画布', { event: 'workspace_transfer.video_edit_canvas.completed', context: { projectId: input.projectId, canvasId: canvas.id, nodeRef, verified: verification.verified } })
    if (typeof result.undoRef !== 'string') throw new Error('画布节点已新增，但撤销回执缺失，请在画布检查结果。')
    return { nodeRef, assetRef: { kind: 'asset', id: asset.id }, undoRef: result.undoRef, verification }
  } catch (error) {
    logger.warn('剪辑内容未完成发送，已有媒体保留', { event: 'workspace_transfer.video_edit_canvas.failed', error, context: { projectId: input.projectId, canvasId: canvas.id } })
    throw error
  }
}
