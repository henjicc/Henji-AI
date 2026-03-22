import React from 'react'
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react'
import { ImageViewerModal } from '@/workspaces/GenerationWorkspace/components/ImageViewerModal'
import { VideoViewerModal } from '@/workspaces/GenerationWorkspace/components/VideoViewerModal'
import { NodeSelectionMenu } from './NodeSelectionMenu'
import { canvasNodeTypes } from './nodes/nodeTypes'
import { useCanvasFlowEditor } from '@/workspaces/canvas/hooks/useCanvasFlowEditor'
import type { ActiveCanvasProject } from '@/workspaces/canvas/hooks/useCanvasProjects'
import { CANVAS_NODE_TYPES, type CanvasFlowEdge, type CanvasFlowNode, type CanvasFlowSnapshot } from '@/workspaces/canvas/types'
import { UiButton } from '@/components/ui'
import { CANVAS_GRID_HEX } from '@/core/theme/colorTokens'
import '@xyflow/react/dist/style.css'

interface CanvasEditorViewProps {
  project: ActiveCanvasProject
  saving: boolean
  onBack: () => void
  onDeleteProject: (projectId: string) => Promise<void>
  onRenameProject: (projectId: string, name: string) => Promise<void>
  onSnapshotChange: (snapshot: CanvasFlowSnapshot) => void
}

export function CanvasEditorView({
  project,
  saving,
  onBack,
  onDeleteProject,
  onRenameProject,
  onSnapshotChange,
}: CanvasEditorViewProps): JSX.Element {
  const [menuPosition, setMenuPosition] = React.useState<{ x: number; y: number } | null>(null)
  const {
    edges,
    viewNodes,
    viewport,
    imageViewerUrl,
    imageViewerPath,
    videoViewerUrl,
    videoViewerPath,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setViewport,
    addNodeByType,
    closeImageViewer,
    closeVideoViewer,
  } = useCanvasFlowEditor({ project, onSnapshotChange })

  return (
    <div className="h-full bg-canvas text-zinc-100">
      <div className="flex h-[52px] items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2">
          <UiButton type="button" variant="muted" size="sm" className="h-7 px-2 text-xs" onClick={onBack}>
            返回项目列表
          </UiButton>
          <div className="text-sm font-medium">{project.name}</div>
          <span className="text-xs text-zinc-500">{saving ? '保存中...' : '已保存'}</span>
        </div>
        <div className="flex items-center gap-2">
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => addNodeByType(CANVAS_NODE_TYPES.upload)}
          >
            + 上传节点
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => addNodeByType(CANVAS_NODE_TYPES.imageEdit)}
          >
            + AI 图片节点
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => addNodeByType(CANVAS_NODE_TYPES.storyboardGen)}
          >
            + 分镜生成节点
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(event) => {
              const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect()
              setMenuPosition({ x: rect.left, y: rect.bottom + 8 })
            }}
          >
            + 更多节点
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={async () => {
              const nextName = window.prompt('输入新项目名', project.name)
              if (!nextName) return
              await onRenameProject(project.id, nextName)
            }}
          >
            重命名
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            size="sm"
            className="h-7 border-red-700/70 bg-red-900/30 px-2 text-xs text-red-200 hover:bg-red-900/45"
            onClick={async () => {
              if (!window.confirm('确认删除该项目？')) return
              await onDeleteProject(project.id)
            }}
          >
            删除项目
          </UiButton>
        </div>
      </div>

      <div className="h-[calc(100%-52px)]">
        <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
          key={project.id}
          nodes={viewNodes}
          edges={edges}
          nodeTypes={canvasNodeTypes}
          defaultViewport={viewport}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
          className="bg-canvas"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={CANVAS_GRID_HEX} />
          <MiniMap zoomable pannable className="!bg-zinc-900/90" />
          <Controls />
        </ReactFlow>
      </div>

      <ImageViewerModal
        open={Boolean(imageViewerUrl)}
        imageUrl={imageViewerUrl || ''}
        imageList={imageViewerUrl ? [imageViewerUrl] : []}
        filePaths={imageViewerPath ? [imageViewerPath] : []}
        currentIndex={0}
        fromUpload={false}
        isEditorMode={false}
        onClose={closeImageViewer}
        onNavigate={() => undefined}
        onEnterEditor={() => undefined}
        onExitEditor={() => undefined}
        onSaveEdit={() => undefined}
      />
      <VideoViewerModal
        open={Boolean(videoViewerUrl)}
        videoUrl={videoViewerUrl || ''}
        filePath={videoViewerPath}
        onClose={closeVideoViewer}
      />

      {menuPosition && (
        <NodeSelectionMenu
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          onSelect={(type) => addNodeByType(type)}
        />
      )}
    </div>
  )
}

