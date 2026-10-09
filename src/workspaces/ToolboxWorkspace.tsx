import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { ICON_TOOL_AUDIO_EDIT } from '@/core/theme/icons'
import { TOOLBOX_RUNTIME } from './toolboxRuntime'
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
import {
  TOOLBOX_RECENT_FILE_LIMIT,
  loadToolboxRecentFiles,
  openToolboxRecentFile,
  type ToolboxRecentFile,
} from '@/features/toolbox/toolboxRecentFiles'
import { formatTaskCreatedAt } from '@/workspaces/GenerationWorkspace/utils/taskMeta'
import { selectToolboxTool, useNavigationStore } from '@/stores/navigationStore'

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
                  <span className={UI_TEXT_PANEL_TITLE_CLASS}>{t(tool.descriptor.titleKey)}</span>
                  <span className={`break-words leading-normal [text-wrap:pretty] ${UI_TEXT_SECONDARY_CLASS}`}>{t(tool.descriptor.descriptionKey)}</span>
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
                    title={`在${tool ? t(tool.descriptor.titleKey) : '工具'}中打开`}
                    onClick={() => openRecent(file)}
                  >
                    <Icon size={16} aria-hidden="true" className="text-text3" />
                    <span className="truncate">{file.name}</span>
                    <span className={UI_TEXT_SECONDARY_CLASS}>{tool ? t(tool.descriptor.titleKey) : null}</span>
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

  return <ToolboxHome />
}

export default ToolboxWorkspace
