import { mediaSourceNodeData, mediaSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { addTrustedMediaCanvasNode } from '@/features/canvas/application/canvasApplicationService'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import type { CanvasNodePlacement } from '@/core/application-control/domains/canvas/canvasMutationApplicationCapabilities'

import { assetApplicationService } from './assetApplicationService'
import type { CanvasCommitOptions } from '@/features/canvas/application/canvasPersistenceService'
import { getPlatform } from '@/platform/runtime'

export async function addAssetToCanvas(input: {
  projectId: string
  assetId: string
  placement: CanvasNodePlacement
}, signal?: AbortSignal, options: CanvasCommitOptions = {}): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const asset = await assetApplicationService.inspect(input.assetId)
  signal?.throwIfAborted()
  if (asset.mediaType === 'code') throw new Error('可编辑代码素材需要导入剪辑；画布媒体节点仅接受图片、视频或音频。')
  const payload: AssetDragPayload = {
    assetId: asset.id,
    type: asset.mediaType,
    sourceType: 'asset',
    filePath: asset.filePath,
    imageUrl: asset.displayUrl,
    thumbnailUrl: asset.thumbnailPath ?? asset.thumbnailUrl,
    aspectRatio: asset.width && asset.height ? `${asset.width}:${asset.height}` : undefined,
    durationSeconds: asset.durationSeconds,
    displayName: asset.displayName,
  }
  const data = mediaSourceNodeData(payload)
  const nodeType = mediaSourceNodeType(asset.mediaType)
  const result = await addTrustedMediaCanvasNode({
    projectId: input.projectId,
    nodeType,
    placement: input.placement,
    data,
  }, options)
  const persisted = await readPersistedCanvasProjectSnapshot(input.projectId)
  const node = persisted.nodes.find(node => node.id === result.nodeId)
  const media = getPlatform().media
  const verified = node?.type === nodeType && Object.entries(data).every(([key, value]) => {
    const actual = node.data[key as keyof typeof node.data]
    // 文档位置编码会把本地协议 URL 回读为路径；比较同一媒体身份，而非传输写法。
    return /url$/i.test(key) && typeof value === 'string' && typeof actual === 'string'
      ? media.toDisplaySrc(actual) === media.toDisplaySrc(value)
      : JSON.stringify(actual) === JSON.stringify(value)
  })
  return { ...result, assetId: asset.id, mediaType: asset.mediaType, nodeRef: { kind: 'canvas.node', id: `${input.projectId}:${String(result.nodeId)}` }, verification: { verified, condition: '原画布已保存并回读新增节点与正式素材的媒体字段。' } }
}
