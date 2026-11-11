import { Redo2, Undo2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton, UiToolbar } from '@/components/ui'
import { UiPrimaryActionContext } from '@/components/ui/actionPriority'
import { useImageEditorBusSnapshotV3 } from './useImageEditorControllerV3'
import { useSelectionAdvancedV3 } from '../tools/selectionAdvanced/SelectionAdvancedContext'
import { useImageEditorRepairV3 } from './ImageEditorRepairContextV3'
import { transformSession } from '../tools/transform/session'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorToolParametersV3 } from './ImageEditorToolParametersV3'
import { ImageEditorClipboardV3 } from './ImageEditorClipboardV3'
import { ImageEditorLayoutControlsV3 } from './ImageEditorLayoutControlsV3'
import { ImageEditorExplanationControlsV3 } from './ImageEditorExplanationControlsV3'
import type { ImageEditorV3Controller } from './types'

interface ImageEditorCommandBarV3Props {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
  toolbarLeading?: React.ReactNode
  toolbarTitle?: React.ReactNode
  toolbarActions?: React.ReactNode
  toolbarDelivery?: React.ReactNode
  panelActions?: React.ReactNode
  contentDisabled?: boolean
}

/**
 * 图片编辑器的单条命令带（工具页统一骨架 `UiToolbar variant="command"`）：
 * 左端 = 宿主注入的返回 + 文件名与保存状态（没有文档时写编辑器名）+ 撤销/重做；
 * 右端依次 = 随当前工具变化的参数、宿主的文件动作、讲解与随手摆和布局、交付动作（加入剪辑、导出）。
 * 参数默认留在同一行；放不下时（960、展开助手侧栏）整组移到紧贴命令带的从属带（共用底色与下边框），
 * 宽度够了再移回，不横向滚动藏参数。复制、粘贴走编辑菜单与快捷键，命令带只显示剪贴板处理中的取消与出错原因。
 */
export function ImageEditorCommandBarV3({
  controller,
  bus,
  toolbarLeading,
  toolbarTitle,
  toolbarActions,
  toolbarDelivery,
  panelActions,
  contentDisabled,
}: ImageEditorCommandBarV3Props): JSX.Element {
  const snapshot = useImageEditorBusSnapshotV3(bus)
  const selection = useSelectionAdvancedV3()
  const repair = useImageEditorRepairV3()
  const transform = transformSession(bus)
  const transformDraft = useSyncExternalStore(transform.subscribe, transform.snapshot)
  const pendingConfirmation = Boolean(selection?.preview || repair?.previewReady || (transformDraft && !transformDraft.error))
    || Object.values(snapshot.previewOverrides).some(preview => preview.kind === 'document-geometry' || preview.kind === 'crop')
  const { t } = useTranslation('ui')
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool,
  )
  const parameterViewportRef = useRef<HTMLDivElement | null>(null)
  const centerSlotRef = useRef<HTMLDivElement | null>(null)
  // 参数在命令带中间放不下时移到从属带；neededWidth 记下放不下那一刻参数的完整宽度，
  // 中间槽位宽度够了再移回，避免来回跳动。
  const [stacked, setStacked] = useState(false)
  const [layoutOpenRequest, setLayoutOpenRequest] = useState(0)
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
      {...(contentDisabled ? { inert: '' } : {})}
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
      // 参数靠右，紧挨着右端动作：它们都是“对当前画面做什么”，与左端的文件信息分开
      center={stacked ? <div ref={centerSlotRef} aria-hidden="true" className="h-10 w-full" /> : <div className="flex w-full min-w-0 justify-end">{parameters}</div>}
      subordinate={stacked ? parameters : undefined}
      trailing={(
        <div
          data-command-bar-actions
          className="flex min-w-0 shrink-0 items-center gap-1.5"
        >
          <UiPrimaryActionContext.Provider value={!pendingConfirmation}>
            {toolbarActions}
            {!contentDisabled && (controller.profile.id === 'full' || controller.profile.id === 'canvas-edit') && <ImageEditorExplanationControlsV3 bus={bus} controller={controller} onGenerated={() => setLayoutOpenRequest(value => value + 1)} />}
            {!contentDisabled && (controller.profile.id === 'full' || controller.profile.id === 'canvas-edit') && <ImageEditorLayoutControlsV3 bus={bus} controller={controller} openRequest={layoutOpenRequest} />}
            {!contentDisabled && panelActions}
            {toolbarDelivery}
          </UiPrimaryActionContext.Provider>
        </div>
      )}
    >
      {toolbarLeading}
      {toolbarTitle ?? (
        // 窄窗口（< 1024）先让出编辑器名：它是固定文案，截成“图片…”不如不显示
        <span className="hidden truncate text-13 font-medium text-text1 lg:inline">
          {t('imageEditor.v3.title')}
        </span>
      )}
      <UiIconButton size="md"
        className="ml-1 shrink-0"
        disabled={contentDisabled || !controller.canUndo}
        aria-label={t('imageEditor.actions.undo')}
        tooltip={t('imageEditor.actions.undo')}
        onClick={controller.undo}
      >
        <Undo2  />
      </UiIconButton>
      <UiIconButton size="md"
        className="shrink-0"
        disabled={contentDisabled || !controller.canRedo}
        aria-label={t('imageEditor.actions.redo')}
        tooltip={t('imageEditor.actions.redo')}
        onClick={controller.redo}
      >
        <Redo2  />
      </UiIconButton>
      {/* 剪贴板：编辑菜单里的复制、粘贴与 Ctrl+C / Ctrl+V；这里只在处理中显示取消与出错原因 */}
      <div {...(contentDisabled ? { inert: '' } : {})}><ImageEditorClipboardV3 bus={bus} controller={controller} disabled={contentDisabled} /></div>
    </UiToolbar>
  )
}
