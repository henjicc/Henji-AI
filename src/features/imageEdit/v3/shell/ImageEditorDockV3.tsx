import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DockviewReact, type DockviewApi, type DockviewGroupPanel, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'

import { DockviewHost } from '@/components/DockviewHost'
import { bindDockDragGestures, DOCKVIEW_HOST_DND_OPTIONS } from '@/components/dockviewDocking'
import { dockviewHostTheme } from '@/components/dockviewHostTheme'
import { UiError } from '@/components/ui'
import { createLogger } from '@/core/logging'
import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry'
import {
  resetImageEditorDockLayoutV3,
  validateImageEditorDockLayoutV3,
  type ImageEditorLayoutStoreV3,
} from '../panelFramework/layout'
import { ImageEditorDockHeaderActionsV3, ImageEditorDockTabV3 } from './ImageEditorDockChromeV3'
import { useImageEditorShellV3 } from './ImageEditorShellContextV3'

const logger = createLogger('features.imageEdit.v3.shell')
const theme = dockviewHostTheme('henji-cameraStage-dock', 4)

function registeredPanel(definition: ImageEditorPanelDefinitionV3): (props: IDockviewPanelProps) => JSX.Element {
  return function Panel({ api }: IDockviewPanelProps): JSX.Element {
    const { controller, collapsed } = useImageEditorShellV3()
    const controllerRef = useRef(controller)
    controllerRef.current = controller
    const [visible, setVisible] = useState(api.isVisible)
    const [location, setLocation] = useState(api.group.api.location.type)
    useEffect(() => {
      const events = [
        api.onDidVisibilityChange(event => setVisible(event.isVisible)),
        api.onDidLocationChange(event => setLocation(event.location.type)),
      ]
      // Dockview may finish layout before React attaches these subscriptions.
      setVisible(api.isVisible)
      setLocation(api.group.api.location.type)
      return () => events.forEach(event => event.dispose())
    }, [api])
    const bodyVisible = visible && !collapsed.has(definition.id)
    // 生命周期以当前文档/controller 为准；切目标时先释放原目标再通知新目标。
    useEffect(() => {
      const current = controllerRef.current
      definition.onVisibilityChange?.({ controller: current, visible: bodyVisible })
      return () => { if (bodyVisible) definition.onVisibilityChange?.({ controller: current, visible: false }) }
    }, [controller.sessionId, controller.document.id, bodyVisible])
    const Body = definition.component
    return <div data-editor-panel data-editor-panel-id={definition.id} data-panel-mode={location === 'floating' ? 'floating' : 'docked'}
      data-docked-editor-panel={location === 'grid' ? '' : undefined}
      data-floating-editor-panel={location === 'floating' ? '' : undefined}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {bodyVisible ? <Body controller={controller} visible={bodyVisible} /> : null}
    </div>
  }
}

export function ImageEditorDockV3({
  layoutStore,
  onApiChange,
  onRestoreCollapsed,
}: {
  layoutStore: ImageEditorLayoutStoreV3
  onApiChange: (api: DockviewApi | null) => void
  onRestoreCollapsed: (ids: readonly string[]) => void
}): JSX.Element {
  const { t } = useTranslation('ui')
  const { controller, panels, api, collapsed, restoreDefault } = useImageEditorShellV3()
  const hostRef = useRef<HTMLDivElement>(null)
  const disposeRef = useRef<() => void>(() => {})
  const collapsedRef = useRef(collapsed)
  const groupSizesRef = useRef(new WeakMap<DockviewGroupPanel, { collapsed: boolean; expandedHeight: number; maximumHeight: number }>())
  collapsedRef.current = collapsed
  const [layoutFailed, setLayoutFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const titles = useCallback((definition: ImageEditorPanelDefinitionV3): string => t(definition.titleKey, { defaultValue: definition.title }), [t])
  const components = useMemo(() => ({
    preview: function Preview(): JSX.Element {
      const { preview } = useImageEditorShellV3()
      return <div className="flex h-full min-h-0 min-w-0">{preview}</div>
    },
    ...Object.fromEntries(panels.map(definition => [definition.id, registeredPanel(definition)])),
  }), [panels])

  const onReady = useCallback(({ api: readyApi }: DockviewReadyEvent): void => {
    disposeRef.current()
    logger.debug('图片面板布局恢复开始', { event: 'image_editor.layout.restore.start', profileId: controller.profile.id })
    try {
      const saved = layoutStore.load(controller.profile.id)
      if (saved === undefined) resetImageEditorDockLayoutV3(readyApi, panels, titles)
      else {
        validateImageEditorDockLayoutV3(saved, panels)
        readyApi.fromJSON(saved.dock)
        onRestoreCollapsed(saved.collapsed)
      }
      logger.debug('图片面板布局恢复完成', { event: 'image_editor.layout.restore.completed' })
    } catch (error) {
      logger.warn('图片面板布局恢复失败', { event: 'image_editor.layout.restore.failed', error })
      resetImageEditorDockLayoutV3(readyApi, panels, titles)
      onRestoreCollapsed([])
      setLayoutFailed(true)
    }
    const previewGroup = readyApi.getPanel('preview')?.group
    if (previewGroup) previewGroup.api.locked = true
    onApiChange(readyApi)
    const root = hostRef.current
    const unbind = root ? bindDockDragGestures(readyApi, { root }) : () => {}
    // 同帧移除并重建同名面板时，always renderer 的旧位置 RAF 尚未释放该 ID。
    // 等待旧 RAF 结束再由正式布局 API 通知新面板，保留预览实例与面板 DOM 状态。
    let layoutFrame: number | undefined
    const layoutAfterPaint = (): void => {
      if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame)
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = undefined
        readyApi.layout(readyApi.width, readyApi.height, true)
      })
    }
    const panelAdded = readyApi.onDidAddPanel(layoutAfterPaint)
    layoutAfterPaint()
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = (): void => {
      timer = undefined
      try {
        layoutStore.save(controller.profile.id, { dock: readyApi.toJSON(), collapsed: [...collapsedRef.current] })
        setSaveFailed(false)
      } catch (error) {
        logger.warn('图片面板布局保存失败', { event: 'image_editor.layout.save.failed', error })
        setSaveFailed(true)
      }
    }
    const event = readyApi.onDidLayoutChange(() => { clearTimeout(timer); timer = setTimeout(save, 200) })
    disposeRef.current = () => {
      event.dispose(); panelAdded.dispose(); unbind()
      if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame)
      if (timer !== undefined) { clearTimeout(timer); save() }
    }
  }, [controller.profile.id, layoutStore, panels, titles, onApiChange, onRestoreCollapsed])

  useEffect(() => () => { disposeRef.current(); onApiChange(null) }, [onApiChange])
  useEffect(() => {
    if (!api) return
    for (const definition of panels) api.getPanel(definition.id)?.api.setTitle(titles(definition))
  }, [api, panels, titles])
  useEffect(() => {
    if (!api) return
    const update = (): void => {
      for (const group of api.groups) {
        if (group.panels.some(panel => panel.id === 'preview')) continue
        const isCollapsed = Boolean(group.activePanel && collapsed.has(group.activePanel.id))
        const headerHeight = group.element.querySelector('.dv-tabs-and-actions-container')?.getBoundingClientRect().height || 32
        const maximumHeight = isCollapsed ? headerHeight : (api.height || 1000)
        const previous = groupSizesRef.current.get(group)
        if (previous?.collapsed === isCollapsed && previous.maximumHeight === maximumHeight) continue
        const expandedHeight = previous?.expandedHeight ?? group.api.height
        groupSizesRef.current.set(group, { collapsed: isCollapsed, expandedHeight, maximumHeight })
        group.api.setConstraints({ minimumHeight: isCollapsed ? headerHeight : 0, maximumHeight })
        if (isCollapsed) group.api.setSize({ height: headerHeight })
        else if (previous?.collapsed) group.api.setSize({ height: Math.min(maximumHeight, Math.max(headerHeight * 2, expandedHeight)) })
      }
    }
    update()
    let disposed = false
    let pending = false
    const schedule = (): void => {
      if (pending) return
      pending = true
      queueMicrotask(() => { pending = false; if (!disposed) update() })
    }
    const events = [api.onDidActivePanelChange(schedule), api.onDidLayoutChange(schedule)]
    return () => { disposed = true; events.forEach(event => event.dispose()) }
  }, [api, collapsed])
  return <div data-editor-panel-workspace data-editor-panel-dock="right" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    {layoutFailed && <UiError title={t('imageEditor.v3.panels.layoutFailed', { defaultValue: '面板布局无法恢复，已使用默认布局' })}
      message={t('imageEditor.v3.panels.layoutFailedMessage', { defaultValue: '图片编辑内容不受影响。你可以继续编辑或恢复默认布局。' })}
      retryLabel={t('imageEditor.v3.panels.defaultLayout', { defaultValue: '恢复默认布局' })}
      onRetry={() => { restoreDefault(); setLayoutFailed(false) }} />}
    {saveFailed && <UiError title={t('imageEditor.v3.panels.saveFailed', { defaultValue: '面板布局未能保存' })}
      message={t('imageEditor.v3.panels.saveFailedMessage', { defaultValue: '图片编辑内容不受影响，下次打开时可能恢复原布局。' })}
      retryLabel={t('imageEditor.v3.panels.defaultLayout', { defaultValue: '恢复默认布局' })}
      onRetry={() => { restoreDefault(); setSaveFailed(false) }} />}
    <DockviewHost ref={hostRef} className="h-full min-h-0 min-w-0 flex-1">
      <DockviewReact className="henji-cameraStage-dock h-full min-h-0 w-full" theme={theme} components={components}
        {...DOCKVIEW_HOST_DND_OPTIONS} floatingGroupBounds="boundedWithinViewport" defaultRenderer="always" keyboardNavigation
        defaultTabComponent={ImageEditorDockTabV3} rightHeaderActionsComponent={ImageEditorDockHeaderActionsV3} onReady={onReady} />
    </DockviewHost>
  </div>
}
