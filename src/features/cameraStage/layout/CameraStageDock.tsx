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
import StageViewportWorkspace from '../viewport/StageViewportWorkspace'
import TimelinePanel from '../timeline/TimelinePanel'
import ShotTimelinePanel from '../simple/ShotTimelinePanel'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'
import { DockHeaderActions, DockTab } from './DockChrome'
import { LAYOUT_STORAGE_KEY, resetLayout, restoreLayout } from './dockLayout'

/**
 * 3D 镜头参考停靠工作区：用 dockview 承载「视口 / 资源管理器 / 属性 / 时间轴」四个可停靠面板，
 * 支持拖拽重排、调整大小、折叠（tab 分组），布局记忆到 localStorage、可重置默认布局。
 * dockview 只做布局容器；面板内容全部复用现有 Ui* 面板组件；面板头由 DockChrome 精简为 AE 风格。
 */

/** 视口面板通过 context 拿截图注册位（layout 反序列化后 params 不含 ref，故走 context 而非 params） */
const ViewportCaptureContext = createContext<React.MutableRefObject<StageCaptureFn | null> | null>(
  null,
)

const ViewportPanel: React.FC<IDockviewPanelProps> = () => {
  const captureRef = useContext(ViewportCaptureContext)
  return (
    <div className="relative h-full w-full">
      <StageViewportWorkspace captureRef={captureRef ?? undefined} />
    </div>
  )
}

const ObjectsPanel: React.FC<IDockviewPanelProps> = () => <ObjectListPanel />
const PropertiesPanel: React.FC<IDockviewPanelProps> = () => <PropertyPanel />
const TimelineDockPanel: React.FC<IDockviewPanelProps> = () => {
  const editorMode = useCameraStageStore((state) => state.editorMode)
  return editorMode === 'simple' ? <ShotTimelinePanel /> : <TimelinePanel />
}

const DOCK_COMPONENTS = {
  viewport: ViewportPanel,
  objects: ObjectsPanel,
  properties: PropertiesPanel,
  timeline: TimelineDockPanel,
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
        if (api) resetLayout(api)
        useCameraStageViewportStore.getState().resetViewports()
      },
    }))

    return (
      <ViewportCaptureContext.Provider value={captureRef}>
        <DockviewReact
          className="henji-cameraStage-dock dockview-theme-abyss"
          components={DOCK_COMPONENTS}
          defaultTabComponent={DockTab}
          rightHeaderActionsComponent={DockHeaderActions}
          onReady={onReady}
        />
      </ViewportCaptureContext.Provider>
    )
  },
)

CameraStageDock.displayName = 'CameraStageDock'

export default CameraStageDock
