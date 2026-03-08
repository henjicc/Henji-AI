import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, TextAnnotationNodeData } from '@/workspaces/canvas/types'
import { UiTextAreaField } from '@/components/ui'

export function TextAnnotationNode({ id, data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const node = data as TextAnnotationNodeData
  return (
    <>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-sky-500" />
      <NodeFrame title={node.displayName}>
        <UiTextAreaField
          value={node.content}
          onChange={(event) => node.onChangeText?.(id, event.target.value)}
          className="min-h-[120px] resize-y px-2 py-1 text-xs"
          placeholder="记录镜头、运镜、角色动作等说明..."
        />
      </NodeFrame>
    </>
  )
}
