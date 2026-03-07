import React, { useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, UploadImageNodeData } from '@/workspaces/canvas/types'

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
          <button
            className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700"
            onClick={() => fileInputRef.current?.click()}
          >
            选择图片
          </button>
          <input
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
            <input
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none"
              placeholder="https://..."
            />
            <button
              className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
              onClick={() => node.onApplyUrl?.(id, urlInput.trim())}
            >
              应用链接
            </button>
          </div>

          {node.imageUrl && (
            <button
              className="block w-full overflow-hidden rounded-md border border-zinc-700"
              onClick={() => node.onOpenImage?.(node.imageUrl!, node.filePath)}
            >
              <img src={node.imageUrl} alt="upload" className="h-40 w-full object-cover" />
            </button>
          )}
        </div>
      </NodeFrame>
    </>
  )
}
