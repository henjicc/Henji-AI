import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
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
import StateKeyframeTimelinePanel from '../stateKeyframes/StateKeyframeTimelinePanel'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'
import { DockviewHost } from '@/components/DockviewHost'
import { dockviewHostTheme } from '@/components/dockviewHostTheme'
import { bindDockDragGestures, dockFloatingGroupsBack, DOCKVIEW_HOST_DND_OPTIONS } from '@/components/dockviewDocking'
import { DockHeaderActions, DockTab } from './DockChrome'
import { LAYOUT_STORAGE_KEY, resetCameraStageWorkspace, restoreLayout } from './dockLayout'

/**
 * 3D 镜头参考停靠工作区：用 dockview 承载「视口 / 场景对象 / 属性（场景设置）/ 状态关键帧」四个可停靠面板，
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
const TimelineDockPanel: React.FC<IDockviewPanelProps> = () => <StateKeyframeTimelinePanel />

const CAMERA_STAGE_DOCK_THEME = dockviewHostTheme('henji-cameraStage-dock', 6)
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
    const hostRef = useRef<HTMLDivElement | null>(null)
    const unbindRef = useRef<() => void>(() => {})

    const onReady = useCallback((event: DockviewReadyEvent): void => {
      apiRef.current = event.api
      restoreLayout(event.api)
      // 应用内浮动组已不是入口（Shift 拖动浮出已关闭）：旧布局里的浮动组恢复后贴到右侧。
      dockFloatingGroupsBack(event.api, (group) => group.api.moveTo({ position: 'right' }))
      // PR 式拖放：整个区域四边可停靠。3D 镜头参考没有独立窗口，Ctrl 拖动与空白处松开不浮出。
      unbindRef.current()
      unbindRef.current = hostRef.current ? bindDockDragGestures(event.api, { root: hostRef.current }) : () => {}
      event.api.onDidLayoutChange(() => {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()))
      })
    }, [])

    useEffect(() => () => unbindRef.current(), [])

    useImperativeHandle(ref, () => ({
      resetLayout: () => {
        const api = apiRef.current
        if (api) resetCameraStageWorkspace(api)
      },
    }))

    return (
      <ViewportCaptureContext.Provider value={captureRef}>
        {/* 层叠隔离与分隔条拖动保护见 DockviewHost（与剪辑工作区共用） */}
        <DockviewHost ref={hostRef} className="h-full w-full">
          <DockviewReact
            className="henji-cameraStage-dock dockview-theme-abyss"
            theme={CAMERA_STAGE_DOCK_THEME}
            components={DOCK_COMPONENTS}
            defaultTabComponent={DockTab}
            rightHeaderActionsComponent={DockHeaderActions}
            {...DOCKVIEW_HOST_DND_OPTIONS}
            onReady={onReady}
          />
        </DockviewHost>
      </ViewportCaptureContext.Provider>
    )
  },
)

CameraStageDock.displayName = 'CameraStageDock'

export default CameraStageDock
