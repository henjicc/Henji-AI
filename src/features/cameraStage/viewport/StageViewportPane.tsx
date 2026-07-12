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
  if (source.kind === 'fixed') return `fixed:${source.view}`
  return `camera:${source.cameraId}`
}

function parseSource(value: string): StageViewportSource {
  if (value === 'director') return { kind: 'director' }
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
  const setViewMode = useCameraStageStore((state) => state.setViewMode)
  const setActiveCameraId = useCameraStageStore((state) => state.setActiveCameraId)
  const middlePointer = useRef<{ x: number; y: number; time: number } | null>(null)
  const cameras = useMemo(() => getCameraObjects(objects), [objects])
  const configuredCameraId = config.source.kind === 'camera' ? config.source.cameraId : null
  const source = configuredCameraId
    && !cameras.some((camera) => camera.id === configuredCameraId)
    ? { kind: 'director' } as const
    : config.source
  const options = [
    { label: '自由透视', value: 'director' },
    ...Object.entries(FIXED_LABELS).map(([view, label]) => ({ label, value: `fixed:${view}` })),
    ...cameras.map((camera) => ({ label: `摄像机 · ${camera.name}`, value: `camera:${camera.id}` })),
  ]

  const activateViewport = (): void => {
    setActive(viewportId)
    if (source.kind === 'camera') {
      setActiveCameraId(source.cameraId)
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
      {source.kind === 'camera' && <StageAspectRatioOverlay cameraId={source.cameraId} />}
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
