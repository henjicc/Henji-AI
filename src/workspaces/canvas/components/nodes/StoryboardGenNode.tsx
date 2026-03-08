import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getI18nText } from '@/core/types/I18nText'
import { registry } from '@/core/ModelRegistry'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, StoryboardGenNodeData } from '@/workspaces/canvas/types'
import { UiButton, UiInput, UiSelect, UiTextAreaField } from '@/components/ui'

function normalizeCount(value: number): number {
  return Math.max(1, Math.min(8, Math.floor(value || 1)))
}

function statusLabel(node: StoryboardGenNodeData): string {
  if (node.isGenerating) return '生成中'
  if (node.error) return '失败'
  return '待执行'
}

export function StoryboardGenNode({ id, data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const node = data as StoryboardGenNodeData
  const imageModels = registry.getModelsByType('image')
  const total = normalizeCount(node.gridRows) * normalizeCount(node.gridCols)
  const frames = node.frames.slice(0, total)

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-sky-500" />
      <NodeFrame title={node.displayName} badge={statusLabel(node)}>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-400">
            行
            <UiInput
              type="number"
              min={1}
              max={8}
              value={node.gridRows}
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
              value={node.gridCols}
              onChange={(event) => node.onChangeCols?.(id, Number(event.target.value))}
              className="mt-1 h-8 text-xs"
            />
          </label>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400">模型</label>
          <UiSelect
            value={node.model}
            onChange={(event) => node.onChangeModel?.(id, event.target.value)}
            className="h-8 text-xs"
          >
            {imageModels.map((model) => (
              <option key={model.meta.id} value={model.meta.id}>
                {getI18nText(model.meta.name, 'zh') || model.meta.id}
              </option>
            ))}
          </UiSelect>
        </div>

        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900/80 p-2">
          {frames.map((frame, index) => (
            <div key={frame.id} className="space-y-1">
              <div className="text-[11px] text-zinc-400">分镜 {String(index + 1).padStart(2, '0')}</div>
              <UiTextAreaField
                value={frame.description}
                onChange={(event) => node.onChangeFrameDesc?.(id, frame.id, event.target.value)}
                className="min-h-[52px] resize-y px-2 py-1 text-xs"
                placeholder="该分镜的画面描述..."
              />
            </div>
          ))}
        </div>

        {node.isGenerating && (
          <div className="space-y-1">
            <div className="text-[11px] text-zinc-300">进度 {Math.round(node.progress)}%</div>
            <div className="h-1.5 w-full rounded bg-zinc-700">
              <div
                className="h-full rounded bg-sky-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, node.progress))}%` }}
              />
            </div>
          </div>
        )}

        {node.error && (
          <div className="rounded-md border border-red-500/40 bg-red-950/30 px-2 py-1 text-xs text-red-300">
            {node.error}
          </div>
        )}

        <UiButton
          type="button"
          variant="primary"
          size="sm"
          className="w-full bg-sky-600 text-xs font-semibold hover:bg-sky-500 disabled:bg-zinc-700"
          disabled={node.isGenerating}
          onClick={() => node.onGenerate?.(id)}
        >
          {node.isGenerating ? '生成分镜中...' : '生成分镜'}
        </UiButton>
      </NodeFrame>
    </>
  )
}
