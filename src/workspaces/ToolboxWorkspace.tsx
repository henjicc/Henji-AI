import React, { Suspense, lazy } from 'react'
import { ICON_TOOL_CAMERA_STAGE, ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import type { LucideIcon } from 'lucide-react'
import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS, UiLoading, UiOptionButton, UiPageHeader, UiRegion } from '@/components/ui'
import type { ToolboxToolId } from '@/core/types/workspace'
import { selectToolboxTool, useNavigationStore } from '@/stores/navigationStore'

// 工具箱首页只是一张卡片列表，不该为它下载 3D 场景和图片编辑器。
// 两个工具改为进入时才加载（TabContainer 会在空闲时预取，正常点进去感知不到等待）。
const CameraStageApp = lazy(() => import('@/features/cameraStage/CameraStageApp'))
const ImageMarkTool = lazy(() => import('@/features/imageMark/standalone/ImageMarkTool'))

/**
 * 工具箱工作区：多工具入口首页 + 各工具的打开/返回导航。
 * 新工具在 TOOLS 里登记并在 renderTool 中接线即可，不改布局骨架。
 *
 * **外层不画任何条带**：返回工具箱的入口由工具自己按所处形态放置——有页面标题的
 * 形态放在标题左侧（`UiPageHeader onBack`），全屏工作面形态放在自带命令带的左端。
 * 此前外层统一画一条「← 工具名」带，结果与应用标题栏叠成双标题栏，还要靠
 * `ownsCommandBar` 之类的开关逐个工具关掉；判据改成「页面长什么样」后特例就没了。
 */

interface ToolboxToolMeta {
  id: ToolboxToolId
  name: string
  description: string
  icon: LucideIcon
}

const TOOLS: ToolboxToolMeta[] = [
  {
    id: 'imageMark',
    name: '图片编辑',
    description: '打开或粘贴图片，快速打序号、框选、画箭头、加文字、打码，支持裁剪与旋转，一键复制或保存',
    icon: ICON_TOOL_IMAGE_EDIT,
  },
  {
    id: 'cameraStage',
    name: '3D 镜头参考',
    description: '搭建三维场景、给角色摆姿势、调机位取景，一键截图给 AI 当参考图',
    icon: ICON_TOOL_CAMERA_STAGE,
  },
]

function renderTool(id: ToolboxToolId, onBack: () => void): React.ReactNode {
  switch (id) {
    case 'cameraStage':
      return <CameraStageApp onBackToToolbox={onBack} />
    case 'imageMark':
      return <ImageMarkTool onBack={onBack} />
  }
}

const ToolboxWorkspace: React.FC = () => {
  const activeToolId = useNavigationStore((state) => state.activeToolId)

  const activeTool = TOOLS.find((tool) => tool.id === activeToolId)
  const backToToolbox = () => selectToolboxTool(null)

  if (activeTool) {
    return (
      <div
        data-application-surface-id={activeTool.id === 'cameraStage' ? 'tool.camera_stage' : 'tool.image_edit'}
        className="flex h-full flex-col bg-app"
      >
        <div className="min-h-0 flex-1">
          <Suspense fallback={<UiLoading className="h-full" />}>
            {renderTool(activeTool.id, backToToolbox)}
          </Suspense>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="p-6">
        <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto">
          <UiPageHeader
            className="mb-6"
            title="工具箱"
            description="独立于生成和画布的实用工具集合"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((tool) => (
              <UiOptionButton
                key={tool.id}
                variant="card"
                className="group h-auto flex-col !items-start gap-2 p-4 text-left"
                onClick={() => selectToolboxTool(tool.id)}
              >
                <tool.icon size={22} className="text-text-muted" />
                <span className={UI_TEXT_LABEL_CLASS}>{tool.name}</span>
                <span className={`break-words leading-relaxed [text-wrap:pretty] group-hover:text-text-soft ${UI_TEXT_META_CLASS}`}>{tool.description}</span>
              </UiOptionButton>
            ))}
          </div>
        </UiRegion>
      </div>
    </div>
  )
}

export default ToolboxWorkspace
