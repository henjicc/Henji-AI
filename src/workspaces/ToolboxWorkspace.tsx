import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { ICON_TOOL_AUDIO_EDIT, ICON_TOOL_CAMERA_STAGE, ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  UI_TEXT_PANEL_TITLE_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECONDARY_CLASS,
  UiLoading,
  UiOptionButton,
  UiPageHeader,
  UiRegion,
} from '@/components/ui'
import type { ToolboxToolId } from '@/core/types/workspace'
import { useNotification } from '@/contexts/NotificationContext'
import { getImageDocumentWorkspace } from '@/features/imageEdit/documents/imageDocumentWorkspace'
import { findOpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import {
  TOOLBOX_RECENT_FILE_LIMIT,
  loadToolboxRecentFiles,
  openToolboxRecentFile,
  type ToolboxRecentFile,
} from '@/features/toolbox/toolboxRecentFiles'
import { formatTaskCreatedAt } from '@/workspaces/GenerationWorkspace/utils/taskMeta'
import { selectToolboxTool, useNavigationStore } from '@/stores/navigationStore'

// 工具首页只是一张卡片列表，不该为它下载 3D 场景和图片编辑器。
// 两个工具改为进入时才加载（TabContainer 会在空闲时预取，正常点进去感知不到等待）。
const CameraStageApp = lazy(() => import('@/features/cameraStage/CameraStageApp'))
const ImageMarkTool = lazy(() => import('@/features/imageMark/standalone/ImageMarkTool'))
const AudioEditApp = lazy(() => import('@/features/audioEdit/AudioEditApp'))

/**
 * 工具工作区：多工具入口首页 + 各工具的打开/返回导航。
 * 新工具在 TOOLS 里登记并在 renderTool 中接线即可，不改布局骨架。
 *
 * **外层不画任何条带**：返回工具首页的入口由工具自己按所处形态放置——有页面标题的
 * 形态放在标题左侧（`UiPageHeader onBack`），全屏工作面形态放在自带命令带
 * （`UiToolbar variant="command"`）的左端。此前外层统一画一条「← 工具名」带，结果与应用
 * 标题栏叠成双标题栏，还要靠 `ownsCommandBar` 之类的开关逐个工具关掉。
 */

interface ToolboxToolMeta {
  id: ToolboxToolId
  name: string
  description: string
  icon: LucideIcon
}

const TOOLS: ToolboxToolMeta[] = [
  {
    id: 'audioEdit',
    name: '口播剪辑',
    description: '按逐字稿剪口播：删掉停顿和语气词，保留想要的句子，导出成片或交给剪辑',
    icon: ICON_TOOL_AUDIO_EDIT,
  },
  {
    id: 'imageMark',
    name: '图片编辑',
    description: '打开或粘贴图片，标注、裁剪、模糊与调整，一键复制或保存',
    icon: ICON_TOOL_IMAGE_EDIT,
  },
  {
    id: 'cameraStage',
    name: '3D 镜头参考',
    description: '搭三维场景、摆角色姿势、调机位取景，截图作为生成参考图',
    icon: ICON_TOOL_CAMERA_STAGE,
  },
]

const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]))

function renderTool(id: ToolboxToolId, onBack: () => void): React.ReactNode {
  switch (id) {
    case 'audioEdit':
      return <AudioEditApp onBack={onBack} />
    case 'cameraStage':
      return <CameraStageApp onBackToToolbox={onBack} />
    case 'imageMark':
      return <ImageMarkTool onBack={onBack} />
  }
}

/** 首页读取一次工程摘要；只在首页挂载时读，不轮询。 */
function useToolboxRecentFiles(): ToolboxRecentFile[] | null {
  const [files, setFiles] = useState<ToolboxRecentFile[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadToolboxRecentFiles().then((next) => { if (!cancelled) setFiles(next) })
    return () => { cancelled = true }
  }, [])
  return files
}

const ToolboxHome: React.FC = () => {
  const { showNotification } = useNotification()
  const recentFiles = useToolboxRecentFiles()
  const latestNameByTool = useMemo(() => {
    const latest = new Map<ToolboxToolId, string>()
    for (const file of recentFiles ?? []) if (!latest.has(file.toolId)) latest.set(file.toolId, file.name)
    // 图片编辑正在编辑的文档（切到工具首页时会话仍开着）排在最前。
    const current = getImageDocumentWorkspace().current
    const editing = current ? findOpenImageDocument(current) : undefined
    if (editing && !editing.session.isEnded) latest.set('imageMark', editing.session.documentMeta.name)
    return latest
  }, [recentFiles])
  const listed = recentFiles?.slice(0, TOOLBOX_RECENT_FILE_LIMIT) ?? []
  const { i18n } = useTranslation()
  const locale = i18n.language || 'zh-CN'

  const openRecent = (file: ToolboxRecentFile): void => {
    void openToolboxRecentFile(file).catch(() => showNotification(`无法打开「${file.name}」，已进入项目列表`, 'error'))
  }

  return (
    <div className="h-full overflow-y-auto bg-window">
      <UiRegion maxWidthClassName="max-w-5xl" className="mx-auto flex flex-col gap-10 p-10">
        <UiPageHeader title="工具" description="不依赖生成和画布、可以单独打开的处理工具" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => {
            const latest = latestNameByTool.get(tool.id)
            return (
              <UiOptionButton
                key={tool.id}
                variant="card"
                className="h-full flex-col !items-start gap-3.5 p-4 text-left"
                onClick={() => selectToolboxTool(tool.id)}
              >
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-control text-text1">
                  <tool.icon size={18} strokeWidth={1.6} />
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className={UI_TEXT_PANEL_TITLE_CLASS}>{tool.name}</span>
                  <span className={`break-words leading-normal [text-wrap:pretty] ${UI_TEXT_SECONDARY_CLASS}`}>{tool.description}</span>
                </span>
                {latest ? <span className={`mt-auto w-full truncate ${UI_TEXT_META_CLASS}`}>最近：{latest}</span> : null}
              </UiOptionButton>
            )
          })}
        </div>
        {listed.length > 0 ? (
          <section aria-label="最近文件" className="flex flex-col gap-2.5">
            <h3 className={UI_TEXT_PANEL_TITLE_CLASS}>最近文件</h3>
            <div className="-mx-2.5 flex flex-col">
              {listed.map((file) => {
                const tool = TOOL_BY_ID.get(file.toolId)
                const Icon = tool?.icon ?? ICON_TOOL_AUDIO_EDIT
                return (
                  <UiOptionButton
                    key={file.key}
                    variant="menu"
                    className="grid min-h-11 w-full grid-cols-[28px_minmax(0,1fr)_140px_120px] items-center gap-3 px-2.5"
                    title={`在${tool?.name ?? '工具'}中打开`}
                    onClick={() => openRecent(file)}
                  >
                    <Icon size={16} aria-hidden="true" className="text-text3" />
                    <span className="truncate">{file.name}</span>
                    <span className={UI_TEXT_SECONDARY_CLASS}>{tool?.name}</span>
                    <span className={`text-right tabular-nums ${UI_TEXT_META_CLASS}`}>{formatTaskCreatedAt(new Date(file.updatedAt), locale)}</span>
                  </UiOptionButton>
                )
              })}
            </div>
          </section>
        ) : null}
      </UiRegion>
    </div>
  )
}

const ToolboxWorkspace: React.FC = () => {
  const activeToolId = useNavigationStore((state) => state.activeToolId)

  const activeTool = TOOLS.find((tool) => tool.id === activeToolId)
  const backToToolbox = () => selectToolboxTool(null)

  if (activeTool) {
    return (
      <div
        data-application-surface-id={activeTool.id === 'cameraStage'
          ? 'tool.camera_stage'
          : activeTool.id === 'audioEdit'
            ? 'tool.audio_edit'
            : 'tool.image_edit'}
        className="flex h-full flex-col bg-window"
      >
        <div className="min-h-0 flex-1">
          <Suspense fallback={<UiLoading className="h-full" />}>
            {renderTool(activeTool.id, backToToolbox)}
          </Suspense>
        </div>
      </div>
    )
  }

  return <ToolboxHome />
}

export default ToolboxWorkspace
