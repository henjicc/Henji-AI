import React, { useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, UploadImageNodeData } from '@/workspaces/canvas/types'
import { UiButton, UiInput } from '@/components/ui'

export function UploadNode({ id, data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const node = data as UploadImageNodeData
  const [urlInput, setUrlInput] = useState(node.imageUrl ?? '')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setUrlInput(node.imageUrl ?? '')
  }, [node.imageUrl])

  return (
    <>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-sky-500" />
      <NodeFrame title={node.displayName}>
        <div className="space-y-2">
          <UiButton
            type="button"
            size="sm"
            variant="muted"
            className="h-8 w-full text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            选择图片
          </UiButton>
          <UiInput
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              node.onSelectFile?.(id, file)
              event.target.value = ''
            }}
          />

          <div className="space-y-1">
            <div className="text-[11px] text-zinc-400">图片链接</div>
            <UiInput
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              className="h-8 text-xs"
              placeholder="https://..."
            />
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              className="h-8 w-full text-xs"
              onClick={() => node.onApplyUrl?.(id, urlInput.trim())}
            >
              应用链接
            </UiButton>
          </div>

          {node.imageUrl && (
            <UiButton
              type="button"
              variant="ghost"
              className="h-auto w-full overflow-hidden rounded-md border border-zinc-700 p-0"
              onClick={() => node.onOpenImage?.(node.imageUrl!, node.filePath)}
            >
              <img src={node.imageUrl} alt="upload" className="h-40 w-full object-cover" />
            </UiButton>
          )}
        </div>
      </NodeFrame>
    </>
  )
}
