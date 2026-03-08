import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import AudioPlayer from '@/components/AudioPlayer'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, ExportImageNodeData } from '@/workspaces/canvas/types'
import { UiButton } from '@/components/ui'

function badge(node: ExportImageNodeData): string {
  if (node.mediaType === 'video') return '视频结果'
  if (node.mediaType === 'audio') return '音频结果'
  return '图片结果'
}

export function ExportImageNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const node = data as ExportImageNodeData
  const imageUrl = node.imageUrl

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-sky-500" />
      <NodeFrame title={node.displayName} badge={badge(node)}>
        {node.mediaType === 'image' && imageUrl && (
          <UiButton
            type="button"
            variant="ghost"
            className="h-auto w-full overflow-hidden rounded-md border border-zinc-700 p-0"
            onClick={() => node.onOpenImage?.(imageUrl, node.filePath)}
          >
            <img src={imageUrl} alt="result" className="h-40 w-full object-cover" />
          </UiButton>
        )}

        {node.mediaType === 'video' && imageUrl && (
          <UiButton
            type="button"
            variant="ghost"
            className="h-auto w-full overflow-hidden rounded-md border border-zinc-700 p-0"
            onClick={() => node.onOpenVideo?.(imageUrl, node.filePath)}
          >
            <video src={imageUrl} className="h-40 w-full object-cover" muted playsInline />
          </UiButton>
        )}

        {node.mediaType === 'audio' && imageUrl && (
          <AudioPlayer src={imageUrl} filePath={node.filePath} className="!w-full max-w-none" />
        )}
      </NodeFrame>
    </>
  )
}
