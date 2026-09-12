import type { HenjiDragTransferData } from '@/contexts/dragDataTransfer'
import type { CanvasNode } from '../domain/canvasNodes'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'
import { resolveNodeDisplayName } from '../domain/nodeDisplay'

export interface CanvasMediaTransfer {
  id: string
  nodeId: string
  label: string
  data: HenjiDragTransferData
}

/** 与连线共用发布结果解析，不读取尚未完成的生成或私有预览。 */
export function getCanvasMediaTransfers(node: CanvasNode, nodes: readonly CanvasNode[]): CanvasMediaTransfer[] {
  const outputs = getGraphNodeMediaOutputs(node, new Map(nodes.map(item => [item.id, item])))
  const name = resolveNodeDisplayName(node.type, node.data)
  return outputs.flatMap((output, index) => {
    if (output.kind === 'text' || !output.url) return []
    const label = outputs.length > 1 ? `${name} ${index + 1}` : name
    return [{
      id: JSON.stringify([node.id, index, output.url]),
      nodeId: node.id,
      label,
      data: { type: output.kind, imageUrl: output.url, sourceType: 'upload' as const,
        displayName: label, thumbnailUrl: output.previewUrl },
    }]
  })
}

export function getSelectedCanvasMediaTransfers(nodes: readonly CanvasNode[], modalities: readonly HenjiDragTransferData['type'][]): CanvasMediaTransfer[] {
  return nodes.filter(node => node.selected).flatMap(node => getCanvasMediaTransfers(node, nodes))
    .filter(item => modalities.includes(item.data.type))
}
