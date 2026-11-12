import { UI_ICON_SIZE } from '@/core/theme/icons'
import { notificationMessage } from '@/i18n/notifications'
import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { Clock3, type LucideIcon } from 'lucide-react'
import { ICON_TOOL_AUDIO_EDIT, ICON_TOOL_DEVELOPER } from '@/core/theme/icons'
import { TOOLBOX_RUNTIME } from './toolboxRuntime'
import { useTranslation } from 'react-i18next'
import {
  UI_TEXT_PANEL_TITLE_CLASS,
  UiLoading,
  UiOptionButton,
  UiPageHeader,
  UiRegion,
} from '@/components/ui'
import type { ToolboxToolId } from '@/core/types/workspace'
import { useNotification } from '@/contexts/NotificationContext'
import {
  TOOLBOX_RECENT_FILE_LIMIT,
  loadToolboxRecentFiles,
  openToolboxRecentFile,
  type ToolboxRecentFile,
} from '@/features/toolbox/toolboxRecentFiles'
import { formatTaskCreatedAt } from '@/workspaces/GenerationWorkspace/utils/taskMeta'
import { selectToolboxTool, useNavigationStore } from '@/stores/navigationStore'
import { setDeveloperPanelOpen, useDeveloperPanel } from '@/features/developer/developerPanelState'

const DEVELOPER_BUILD = import.meta.env.DEV || import.meta.env.MODE === 'development'
// 正式构建里整块裁掉：不出现在工具箱，也不打包面板代码。
const SdkModelsPage = DEVELOPER_BUILD
  ? React.lazy(() => import('@/features/developer/SdkModelsPage').then((module) => ({ default: module.SdkModelsPage })))
  : null

/** 工具首页与工作面共用同一装配结果；返回入口仍由各工具持有。 */
const TOOLS = TOOLBOX_RUNTIME.map((tool) => ({ ...tool, id: tool.descriptor.id }))
const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]))

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

/** 工具卡：图标、名称、一行说明（第三档，放不下截断、悬停看全），最近打开的文件带时钟图标放在底部。 */
const ToolCard: React.FC<{ icon: LucideIcon; title: string; description: string; recent?: string; onSelect: () => void; 'data-developer-tool'?: string }> = ({ icon: Icon, title, description, recent, onSelect, ...props }) => (
  <UiOptionButton variant="card" className="h-full min-w-0 flex-col !items-start gap-3 text-left" onClick={onSelect} {...props}>
    <Icon size={UI_ICON_SIZE.lg} aria-hidden="true" className="shrink-0 text-text2" />
    <span className="flex w-full min-w-0 flex-col gap-1">
      <span className={UI_TEXT_PANEL_TITLE_CLASS}>{title}</span>
      <span className="truncate text-xs text-text3" title={description}>{description}</span>
      {recent ? (
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text3">
          <Clock3 size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-icon-rest" />
          <span className="truncate" title={recent}>{recent}</span>
        </span>
      ) : null}
    </span>
  </UiOptionButton>
)

const ToolboxHome: React.FC = () => {
  const { showNotification } = useNotification()
  const recentFiles = useToolboxRecentFiles()
  const latestNameByTool = useMemo(() => {
    const latest = new Map<ToolboxToolId, string>()
    for (const file of recentFiles ?? []) if (!latest.has(file.toolId)) latest.set(file.toolId, file.name)
    for (const tool of TOOLS) {
      const name = tool.currentDocumentName?.()
      if (name) latest.set(tool.id, name)
    }
    return latest
  }, [recentFiles])
  const listed = recentFiles?.slice(0, TOOLBOX_RECENT_FILE_LIMIT) ?? []
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'zh-CN'

  const openRecent = (file: ToolboxRecentFile): void => {
    void openToolboxRecentFile(file).catch(() => showNotification(notificationMessage('openRecentFailed', { name: file.name }), 'error'))
  }

  return (
    <div className="h-full overflow-y-auto bg-window">
      <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto flex flex-col gap-8 p-8">
        <UiPageHeader title="工具" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TOOLS.map((tool) => (
            <ToolCard
              key={tool.id}
              icon={tool.icon}
              title={t(tool.descriptor.titleKey)}
              description={t(tool.descriptor.summaryKey)}
              recent={latestNameByTool.get(tool.id)}
              onSelect={() => selectToolboxTool(tool.id)}
            />
          ))}
          {DEVELOPER_BUILD ? (
            <ToolCard
              icon={ICON_TOOL_DEVELOPER}
              title="开发者"
              description="SDK 适配的全部模型：筛选、离线构建请求、转到生成页实测"
              onSelect={() => setDeveloperPanelOpen(true)}
              data-developer-tool=""
            />
          ) : null}
        </div>
        {listed.length > 0 ? (
          <section aria-label="最近文件" className="flex flex-col gap-2">
            <h3 className="text-13 text-text2">最近文件</h3>
            <div className="-mx-3 flex flex-col">
              {listed.map((file) => {
                const tool = TOOL_BY_ID.get(file.toolId)
                const Icon = tool?.icon ?? ICON_TOOL_AUDIO_EDIT
                return (
                  <UiOptionButton
                    key={file.key}
                    variant="menu"
                    className="grid min-h-9 w-full grid-cols-[28px_minmax(0,1fr)_140px_120px] items-center gap-3"
                    tooltip={`在${tool ? t(tool.descriptor.titleKey) : '工具'}中打开`}
                    onClick={() => openRecent(file)}
                  >
                    <Icon size={UI_ICON_SIZE.md} aria-hidden="true" className="text-text2" />
                    <span className="truncate text-text1">{file.name}</span>
                    <span className="truncate text-xs text-text3">{tool ? t(tool.descriptor.titleKey) : null}</span>
                    <span className="text-right text-xs tabular-nums text-text3">{formatTaskCreatedAt(new Date(file.updatedAt), locale)}</span>
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
  const developerOpen = useDeveloperPanel((state) => state.open)
  useEffect(() => { if (activeToolId) setDeveloperPanelOpen(false) }, [activeToolId])

  const activeTool = TOOLS.find((tool) => tool.id === activeToolId)
  const backToToolbox = () => selectToolboxTool(null)

  if (activeTool) {
    return (
      <div
        data-application-surface-id={activeTool.descriptor.surfaceId}
        className="flex h-full flex-col bg-window"
      >
        <div className="min-h-0 flex-1">
          <Suspense fallback={<UiLoading className="h-full" />}>
            <activeTool.component onBack={backToToolbox} />
          </Suspense>
        </div>
      </div>
    )
  }

  if (SdkModelsPage && developerOpen) {
    return (
      <div data-developer-panel="" className="flex h-full flex-col bg-window">
        <Suspense fallback={<UiLoading className="h-full" />}>
          <SdkModelsPage onBack={() => setDeveloperPanelOpen(false)} />
        </Suspense>
      </div>
    )
  }

  return <ToolboxHome />
}

export default ToolboxWorkspace
