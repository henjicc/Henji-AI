import React, { useMemo, useRef } from 'react'
import { Dropdown } from '@/components/ui'
import { getCameraObjects } from '../domain/cameraUtils'
import StageScene from '../scene/StageScene'
import StageAspectRatioOverlay from '../scene/StageAspectRatioOverlay'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'
import type { StageViewportId, StageViewportSource } from './viewportTypes'

interface StageViewportPaneProps {
  viewportId: StageViewportId
  captureRef?: React.MutableRefObject<StageCaptureFn | null>
  primary: boolean
}

const FIXED_LABELS = {
  top: '顶视图',
  bottom: '底视图',
  front: '正视图',
  back: '后视图',
  left: '左视图',
  right: '右视图',
} as const

function sourceValue(source: StageViewportSource): string {
  if (source.kind === 'director') return 'director'
  if (source.kind === 'active_camera') return 'active_camera'
  if (source.kind === 'fixed') return `fixed:${source.view}`
  return `camera:${source.cameraId}`
}

function parseSource(value: string): StageViewportSource {
  if (value === 'director') return { kind: 'director' }
  if (value === 'active_camera') return { kind: 'active_camera' }
  if (value.startsWith('camera:')) return { kind: 'camera', cameraId: value.slice(7) }
  const view = value.slice(6) as keyof typeof FIXED_LABELS
  return { kind: 'fixed', view }
}

const StageViewportPane: React.FC<StageViewportPaneProps> = ({ viewportId, captureRef, primary }) => {
  const config = useCameraStageViewportStore((state) => state.viewports[viewportId])
  const active = useCameraStageViewportStore((state) => state.activeViewportId === viewportId)
  const setActive = useCameraStageViewportStore((state) => state.setActiveViewport)
  const setSource = useCameraStageViewportStore((state) => state.setViewportSource)
  const toggleMaximized = useCameraStageViewportStore((state) => state.toggleMaximized)
  const objects = useCameraStageStore((state) => state.objects)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setViewMode = useCameraStageStore((state) => state.setViewMode)
  const setActiveCameraId = useCameraStageStore((state) => state.setActiveCameraId)
  const middlePointer = useRef<{ x: number; y: number; time: number } | null>(null)
  const cameras = useMemo(() => getCameraObjects(objects), [objects])
  const configuredCameraId = config.source.kind === 'camera' ? config.source.cameraId : null
  /*
   * 绑死的摄像机不在场景里时，退回**跟随当前机位**而不是自由透视。
   *
   * 退回自由透视会让四窗格里出现两个一模一样的透视画面（左上角本来就是自由透视），信息量
   * 直接少掉四分之一，而用户什么都没做——只是换了个工程，或者删掉了那台摄像机。
   */
  const source: StageViewportSource = configuredCameraId
    && !cameras.some((camera) => camera.id === configuredCameraId)
    ? { kind: 'active_camera' }
    : config.source
  // 取景框覆盖层要知道画的是哪台机器；跟随档在这里落成具体 id。
  const overlayCameraId = source.kind === 'camera'
    ? source.cameraId
    : source.kind === 'active_camera' ? activeCameraId : null
  const options = [
    { label: '自由透视', value: 'director' },
    { label: '当前摄像机', value: 'active_camera' },
    ...Object.entries(FIXED_LABELS).map(([view, label]) => ({ label, value: `fixed:${view}` })),
    ...cameras.map((camera) => ({ label: `摄像机 · ${camera.name}`, value: `camera:${camera.id}` })),
  ]

  const activateViewport = (): void => {
    setActive(viewportId)
    if (source.kind === 'camera') {
      setActiveCameraId(source.cameraId)
      setViewMode('camera')
    } else if (source.kind === 'active_camera') {
      // 已经是当前机位，不需要再指定一次；只把编辑模式切到摄像机视角。
      setViewMode('camera')
    } else {
      setViewMode('director')
    }
  }

  const handleSourceChange = (value: string): void => {
    const next = parseSource(value)
    setSource(viewportId, next)
    if (next.kind === 'camera') {
      setActiveCameraId(next.cameraId)
      setViewMode('camera')
    } else if (next.kind === 'active_camera') {
      setViewMode('camera')
    } else {
      setViewMode('director')
    }
  }

  return (
    <div
      className={`relative min-h-0 min-w-0 overflow-hidden border ${active ? 'border-accent' : 'border-border-dark'}`}
      onPointerDownCapture={(event) => {
        activateViewport()
        if (event.button === 1) {
          middlePointer.current = { x: event.clientX, y: event.clientY, time: performance.now() }
        }
      }}
      onPointerUpCapture={(event) => {
        if (event.button !== 1 || !middlePointer.current) return
        const start = middlePointer.current
        middlePointer.current = null
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (distance <= 4 && performance.now() - start.time <= 450) toggleMaximized(viewportId)
      }}
      onAuxClick={(event) => event.preventDefault()}
    >
      <StageScene
        viewportSource={source}
        interactive={active}
        primary={primary}
        captureRef={primary ? captureRef : undefined}
      />
      {overlayCameraId && <StageAspectRatioOverlay cameraId={overlayCameraId} />}
      <div className="pointer-events-auto absolute left-2 top-2 z-20">
        <Dropdown<string>
          value={sourceValue(source)}
          display={options.find((option) => option.value === sourceValue(source))?.label ?? '自由透视'}
          options={options}
          onSelect={handleSourceChange}
          className="min-w-24"
          buttonClassName="h-7 bg-surface-dark/90 py-1 text-xs"
          buttonLabelClassName="text-xs"
          optionLabelClassName="text-xs"
          minWidthStrategy="options"
          panelWidthStrategy="options"
        />
      </div>
    </div>
  )
}

export default StageViewportPane
