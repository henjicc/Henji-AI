import { Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton, UiToolbar } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorToolParametersV3 } from './ImageEditorToolParametersV3'
import type { ImageEditorV3Controller } from './types'

interface ImageEditorCommandBarV3Props {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
  toolbarLeading?: React.ReactNode
  toolbarActions?: React.ReactNode
}

/**
 * 图片编辑器的单条命令带（工具页统一骨架 `UiToolbar variant="command"`）：
 * 左端 = 宿主注入的返回 + 编辑器名 + 撤销/重做；中间 = 随当前工具变化的参数（超宽时横向滚动）；
 * 右端 = 宿主注入的打开/发送/导出等动作。参数刻意留在同一行，不另开从属带。
 */
export function ImageEditorCommandBarV3({
  controller,
  bus,
  toolbarLeading,
  toolbarActions,
}: ImageEditorCommandBarV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool,
  )
  const parameterViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (parameterViewportRef.current) parameterViewportRef.current.scrollLeft = 0
  }, [activeTool])

  return (
    <UiToolbar
      variant="command"
      barProps={{ 'data-document-revision': controller.document.revision }}
      center={(
        <div
          ref={parameterViewportRef}
          data-tool-parameter-viewport
          className="flex h-10 min-w-0 max-w-full items-center overflow-x-auto px-1"
        >
          <ImageEditorToolParametersV3 controller={controller} bus={bus} />
        </div>
      )}
      trailing={(
        <div
          data-command-bar-actions
          className="flex min-w-0 shrink-0 items-center gap-1.5"
        >
          {toolbarActions}
        </div>
      )}
    >
      {toolbarLeading}
      <span className="truncate text-13 font-medium text-text1">
        {t('imageEditor.v3.title')}
      </span>
      <UiIconButton size="lg"
        className="ml-1 shrink-0"
        disabled={!controller.canUndo}
        aria-label={t('imageEditor.actions.undo')}
        title={t('imageEditor.actions.undo')}
        onClick={controller.undo}
      >
        <Undo2 className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton size="lg"
        className="shrink-0"
        disabled={!controller.canRedo}
        aria-label={t('imageEditor.actions.redo')}
        title={t('imageEditor.actions.redo')}
        onClick={controller.redo}
      >
        <Redo2 className="h-4 w-4" />
      </UiIconButton>
    </UiToolbar>
  )
}
