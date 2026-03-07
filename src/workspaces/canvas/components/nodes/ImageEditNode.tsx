import React, { useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getI18nText } from '@/core/types/I18nText'
import { registry } from '@/core/ModelRegistry'
import { ParamRenderer } from '@/components/params/ParamRenderer'
import { NodeFrame } from './NodeFrame'
import type { CanvasFlowNode, ImageEditNodeData } from '@/workspaces/canvas/types'

function statusLabel(node: ImageEditNodeData): string {
  if (node.isGenerating) return '生成中'
  if (node.error) return '失败'
  if (node.imageUrl) return '已生成'
  return '待执行'
}

export function ImageEditNode({ id, data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const node = data as ImageEditNodeData
  const [showParams, setShowParams] = useState(false)
  const models = useMemo(() => registry.getModelsByType('image'), [])
  const schema = useMemo(
    () =>
      [...registry.getSchema(node.model)]
        .filter((param) => !['prompt', 'text', 'images', 'uploadedFilePaths', 'videos', 'uploadedVideoFilePaths'].includes(param.id))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [node.model]
  )

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-sky-500" />
      <NodeFrame title={node.displayName} badge={statusLabel(node)}>
        {node.imageUrl && (
          <button
            className="block w-full overflow-hidden rounded-md border border-zinc-700"
            onClick={() => node.onOpenImage?.(node.imageUrl!, node.filePath)}
          >
            <img src={node.imageUrl} alt="generated" className="h-36 w-full object-cover" />
          </button>
        )}

        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400">模型</label>
          <select
            value={node.model}
            onChange={(event) => node.onChangeModel?.(id, event.target.value)}
            className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none"
          >
            {models.map((model) => (
              <option key={model.meta.id} value={model.meta.id}>
                {getI18nText(model.meta.name, 'zh') || model.meta.id}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400">提示词</label>
          <textarea
            value={node.prompt}
            onChange={(event) => node.onChangePrompt?.(id, event.target.value)}
            className="min-h-[86px] w-full resize-y rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none"
            placeholder="输入提示词，可连接上游图片作为参考..."
          />
        </div>

        <button
          className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          onClick={() => setShowParams((prev) => !prev)}
        >
          {showParams ? '收起参数' : '展开参数'}
        </button>

        {showParams && (
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900/80 p-2">
            {schema.map((param) => (
              <ParamRenderer
                key={param.id}
                param={param}
                value={node.params[param.id]}
                onChange={(value) => node.onChangeParam?.(id, param.id, value)}
                allValues={node.params}
              />
            ))}
          </div>
        )}

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

        <button
          className="w-full rounded-md bg-sky-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
          disabled={node.isGenerating}
          onClick={() => node.onGenerate?.(id)}
        >
          {node.isGenerating ? '生成中...' : '执行生成'}
        </button>
      </NodeFrame>
    </>
  )
}
