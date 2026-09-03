import { Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorToolParametersV3 } from './ImageEditorToolParametersV3'
import type { ImageEditorV3Controller } from './types'

interface ImageEditorCommandBarV3Props {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
  toolbarLeading?: React.ReactNode
  toolbarActions?: React.ReactNode
}

export function ImageEditorCommandBarV3({
  controller,
  bus,
  toolbarLeading,
  toolbarActions,
}: ImageEditorCommandBarV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const EditorIcon = ICON_TOOL_IMAGE_EDIT
  const zoom = useImageEditorInteractionStoreV3(
    (state) => state.viewportZoomBySession[controller.sessionId] ?? 1,
  )
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool,
  )
  const parameterViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (parameterViewportRef.current) parameterViewportRef.current.scrollLeft = 0
  }, [activeTool])

  return (
    <header
      data-command-stack
      className="shrink-0 border-b border-border-dark bg-panel"
    >
      <div
        data-command-bar
        data-document-revision={controller.document.revision}
        className="flex h-12 min-w-0 items-center gap-2 px-3"
      >
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {toolbarLeading}
          <EditorIcon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-text-dark">
            {t('imageEditor.v3.title')}
          </span>
        </div>
        <div className="mx-1 h-5 w-px shrink-0 bg-border-dark" aria-hidden="true" />
        <UiIconButton
          className="h-8 w-8 shrink-0"
          showBorder={false}
          appearance="hover-only"
          disabled={!controller.canUndo}
          aria-label={t('imageEditor.actions.undo')}
          title={t('imageEditor.actions.undo')}
          onClick={controller.undo}
        >
          <Undo2 className="h-4 w-4" />
        </UiIconButton>
        <UiIconButton
          className="h-8 w-8 shrink-0"
          showBorder={false}
          appearance="hover-only"
          disabled={!controller.canRedo}
          aria-label={t('imageEditor.actions.redo')}
          title={t('imageEditor.actions.redo')}
          onClick={controller.redo}
        >
          <Redo2 className="h-4 w-4" />
        </UiIconButton>
        <div
          ref={parameterViewportRef}
          data-tool-parameter-viewport
          className="min-w-0 flex-1 overflow-x-auto px-1"
        >
          <ImageEditorToolParametersV3 controller={controller} bus={bus} />
        </div>
        <div
          data-command-bar-actions
          className="flex min-w-0 shrink-0 items-center gap-3"
        >
          <span className="w-12 text-right text-xs tabular-nums text-text-muted">
            {Math.round(zoom * 100)}%
          </span>
          {toolbarActions}
        </div>
      </div>
    </header>
  )
}
