import React, { useState } from 'react'
import { ArrowLeft, Clapperboard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { UiIconButton, UiOptionButton } from '@/components/ui'
import CameraStageApp from '@/features/cameraStage/CameraStageApp'
import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'

/**
 * 工具箱工作区：多工具入口首页 + 各工具的打开/返回导航。
 * 新工具在 TOOLS 里登记并在 renderTool 中接线即可，不改布局骨架。
 */

type ToolboxToolId = 'cameraStage'

interface ToolboxToolMeta {
  id: ToolboxToolId
  name: string
  description: string
  icon: LucideIcon
}

const TOOLS: ToolboxToolMeta[] = [
  {
    id: 'cameraStage',
    name: '运镜控制',
    description: '搭建三维场景、给角色摆姿势、调机位取景，一键截图给 AI 当参考图',
    icon: Clapperboard,
  },
]

function renderTool(id: ToolboxToolId): React.ReactNode {
  switch (id) {
    case 'cameraStage':
      return <CameraStageApp />
  }
}

const ToolboxWorkspace: React.FC = () => {
  const [activeToolId, setActiveToolId] = useState<ToolboxToolId | null>(null)
  const cameraStageView = useCameraStageSessionStore((state) => state.appView)

  const activeTool = TOOLS.find((tool) => tool.id === activeToolId)
  const showToolHeader = activeToolId !== 'cameraStage' || cameraStageView !== 'editor'

  if (activeTool) {
    return (
      <div className="flex h-full flex-col bg-app">
        {showToolHeader && (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-dark bg-surface-dark px-2">
            <UiIconButton
              showBorder={false}
              appearance="hover-only"
              className="h-7 w-7"
              title="返回工具箱"
              onClick={() => setActiveToolId(null)}
            >
              <ArrowLeft size={15} />
            </UiIconButton>
            <span className="text-sm font-medium text-text-dark">{activeTool.name}</span>
          </div>
        )}
        <div className="min-h-0 flex-1">{renderTool(activeTool.id)}</div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-1 text-lg font-medium text-text-dark">工具箱</div>
        <div className="mb-6 text-sm text-text-muted">独立于生成和画布的实用工具集合</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <UiOptionButton
              key={tool.id}
              variant="card"
              className="h-auto flex-col !items-start gap-2 p-4 text-left"
              onClick={() => setActiveToolId(tool.id)}
            >
              <tool.icon size={22} className="text-text-muted" />
              <span className="text-sm font-medium">{tool.name}</span>
              <span className="text-xs leading-relaxed text-text-muted">{tool.description}</span>
            </UiOptionButton>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ToolboxWorkspace
