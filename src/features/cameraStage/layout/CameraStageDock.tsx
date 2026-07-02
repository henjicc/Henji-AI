import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useRef,
} from 'react'
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import ObjectListPanel from '../panels/ObjectListPanel'
import PropertyPanel from '../panels/PropertyPanel'
import StageScene from '../scene/StageScene'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'

/**
 * 运镜控制停靠工作区：用 dockview 承载「视口 / 资源管理器 / 属性」三个可停靠面板，
 * 支持拖拽重排、调整大小、折叠（tab 分组），布局记忆到 localStorage、可重置默认布局。
 * dockview 只做布局容器；面板内容全部复用现有 Ui* 面板组件。
 */

const LAYOUT_STORAGE_KEY = 'henji.cameraStage.dockLayout.v1'

/** 视口面板通过 context 拿截图注册位（layout 反序列化后 params 不含 ref，故走 context 而非 params） */
const ViewportCaptureContext = createContext<React.MutableRefObject<StageCaptureFn | null> | null>(
  null,
)

const ViewportPanel: React.FC<IDockviewPanelProps> = () => {
  const captureRef = useContext(ViewportCaptureContext)
  return <StageScene captureRef={captureRef ?? undefined} />
}

const ObjectsPanel: React.FC<IDockviewPanelProps> = () => <ObjectListPanel />
const PropertiesPanel: React.FC<IDockviewPanelProps> = () => <PropertyPanel />

const DOCK_COMPONENTS = {
  viewport: ViewportPanel,
  objects: ObjectsPanel,
  properties: PropertiesPanel,
}

function buildDefaultLayout(api: DockviewApi): void {
  api.clear()
  api.addPanel({ id: 'viewport', component: 'viewport', title: '视口', renderer: 'always' })
  api.addPanel({
    id: 'objects',
    component: 'objects',
    title: '资源管理器',
    position: { referencePanel: 'viewport', direction: 'right' },
    initialWidth: 280,
  })
  api.addPanel({
    id: 'properties',
    component: 'properties',
    title: '属性',
    position: { referencePanel: 'objects', direction: 'below' },
  })
}

function restoreLayout(api: DockviewApi): void {
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
  if (saved) {
    try {
      api.fromJSON(JSON.parse(saved))
      return
    } catch {
      localStorage.removeItem(LAYOUT_STORAGE_KEY)
    }
  }
  buildDefaultLayout(api)
}

export interface CameraStageDockHandle {
  resetLayout: () => void
}

interface CameraStageDockProps {
  captureRef: React.MutableRefObject<StageCaptureFn | null>
}

const CameraStageDock = forwardRef<CameraStageDockHandle, CameraStageDockProps>(
  ({ captureRef }, ref) => {
    const apiRef = useRef<DockviewApi | null>(null)

    const onReady = useCallback((event: DockviewReadyEvent): void => {
      apiRef.current = event.api
      restoreLayout(event.api)
      event.api.onDidLayoutChange(() => {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()))
      })
    }, [])

    useImperativeHandle(ref, () => ({
      resetLayout: () => {
        const api = apiRef.current
        if (!api) return
        localStorage.removeItem(LAYOUT_STORAGE_KEY)
        buildDefaultLayout(api)
      },
    }))

    return (
      <ViewportCaptureContext.Provider value={captureRef}>
        <DockviewReact
          className="henji-cameraStage-dock dockview-theme-abyss"
          components={DOCK_COMPONENTS}
          onReady={onReady}
        />
      </ViewportCaptureContext.Provider>
    )
  },
)

CameraStageDock.displayName = 'CameraStageDock'

export default CameraStageDock
