import { Redo2, Undo2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * 左端 = 宿主注入的返回 + 编辑器名 + 撤销/重做；中间 = 随当前工具变化的参数；
 * 右端 = 宿主注入的打开/发送/导出等动作。参数默认留在同一行；中间放不下时（960、展开助手侧栏）
 * 整组移到紧贴命令带的从属带（共用底色与下边框），宽度够了再移回，不再横向滚动藏参数（5.5 IE-08）。
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
  const centerSlotRef = useRef<HTMLDivElement | null>(null)
  // 参数在命令带中间放不下时移到从属带；neededWidth 记下放不下那一刻参数的完整宽度，
  // 中间槽位宽度够了再移回，避免来回跳动。
  const [stacked, setStacked] = useState(false)
  const neededWidthRef = useRef(0)

  useEffect(() => {
    if (parameterViewportRef.current) parameterViewportRef.current.scrollLeft = 0
  }, [activeTool])

  useLayoutEffect(() => {
    const viewport = parameterViewportRef.current
    const slot = centerSlotRef.current
    const target = stacked ? slot : viewport
    if (!target) return undefined
    const evaluate = (): void => {
      if (!stacked && viewport) {
        if (viewport.scrollWidth > viewport.clientWidth + 1) {
          neededWidthRef.current = viewport.scrollWidth
          setStacked(true)
        }
        return
      }
      if (stacked && slot && slot.clientWidth >= neededWidthRef.current) setStacked(false)
    }
    evaluate()
    const ResizeObserverCtor = target.ownerDocument.defaultView?.ResizeObserver
    if (!ResizeObserverCtor) return undefined
    const observer = new ResizeObserverCtor(evaluate)
    observer.observe(target)
    if (!stacked && viewport?.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => observer.disconnect()
  }, [activeTool, stacked])

  const parameters = (
    <div
      ref={parameterViewportRef}
      data-tool-parameter-viewport
      data-stacked={stacked ? 'true' : undefined}
      className={stacked
        ? 'flex min-h-10 min-w-0 flex-wrap items-center gap-y-1.5'
        : 'flex h-10 min-w-0 max-w-full items-center overflow-hidden px-1'}
    >
      <ImageEditorToolParametersV3 controller={controller} bus={bus} />
    </div>
  )

  return (
    <UiToolbar
      variant="command"
      barProps={{ 'data-document-revision': controller.document.revision }}
      center={stacked ? <div ref={centerSlotRef} aria-hidden="true" className="h-10 w-full" /> : parameters}
      subordinate={stacked ? parameters : undefined}
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
