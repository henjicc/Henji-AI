import React, { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, StoryboardSplitNodeData } from '@/workspaces/canvas/types'
import { UiButton, UiInput, UiTextAreaField } from '@/components/ui'

function normalizeCount(value: number): number {
  return Math.max(1, Math.min(8, Math.floor(value || 1)))
}

function buildBadge(node: StoryboardSplitNodeData): string {
  if (node.isSplitting) return '切割中'
  if (node.error) return '失败'
  if (node.frames.length > 0) return `共 ${node.frames.length} 帧`
  return '待切割'
}

export function StoryboardSplitNode({ id, data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const node = data as StoryboardSplitNodeData
  const rows = normalizeCount(node.gridRows)
  const cols = normalizeCount(node.gridCols)
  const total = rows * cols

  const orderedFrames = useMemo(
    () => [...node.frames].sort((a, b) => a.order - b.order).slice(0, total),
    [node.frames, total]
  )

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-sky-500" />
      <NodeFrame title={node.displayName} badge={buildBadge(node)}>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-400">
            行
            <UiInput
              type="number"
              min={1}
              max={8}
              value={rows}
              onChange={(event) => node.onChangeRows?.(id, Number(event.target.value))}
              className="mt-1 h-8 text-xs"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            列
            <UiInput
              type="number"
              min={1}
              max={8}
              value={cols}
              onChange={(event) => node.onChangeCols?.(id, Number(event.target.value))}
              className="mt-1 h-8 text-xs"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <UiButton
            type="button"
            size="sm"
            variant="muted"
            className="h-8 flex-1 text-xs disabled:bg-zinc-800/50 disabled:text-zinc-500"
            disabled={node.isSplitting}
            onClick={() => node.onSplitInput?.(id)}
          >
            {node.isSplitting ? '切割中...' : '切割输入'}
          </UiButton>
          <UiButton
            type="button"
            size="sm"
            variant="muted"
            className="h-8 flex-1 text-xs"
            onClick={() => node.onExport?.(id)}
          >
            导出拼图
          </UiButton>
        </div>

        {orderedFrames.length === 0 ? (
          <div className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-4 text-center text-xs text-zinc-500">
            连接上游图片后，点击“切割输入”
          </div>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900/70 p-2">
            {orderedFrames.map((frame, index) => (
              <div key={frame.id} className="space-y-1 rounded-md border border-zinc-700 bg-zinc-950/70 p-2">
                <div className="text-[11px] text-zinc-400">分镜 {String(index + 1).padStart(2, '0')}</div>
                {frame.imageUrl && (
                  <UiButton
                    type="button"
                    variant="ghost"
                    className="h-auto w-full overflow-hidden rounded border border-zinc-700 p-0"
                    onClick={() => node.onOpenImage?.(frame.imageUrl!, frame.filePath)}
                  >
                    <img src={frame.imageUrl} alt={`frame-${index + 1}`} className="h-28 w-full object-cover" />
                  </UiButton>
                )}
                <UiTextAreaField
                  value={frame.note}
                  onChange={(event) => node.onChangeFrameNote?.(id, frame.id, event.target.value)}
                  className="min-h-[52px] resize-y px-2 py-1 text-xs"
                  placeholder="该分镜说明..."
                />
              </div>
            ))}
          </div>
        )}

        {node.error && (
          <div className="rounded-md border border-red-500/40 bg-red-950/30 px-2 py-1 text-xs text-red-300">
            {node.error}
          </div>
        )}
      </NodeFrame>
    </>
  )
}
