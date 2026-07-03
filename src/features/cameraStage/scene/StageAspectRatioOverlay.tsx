import React, { useEffect, useRef, useState } from 'react'
import { getCameraObjects } from '../domain/cameraUtils'
import { useCameraStageStore } from '../store/cameraStageStore'

interface ViewportSize {
  width: number
  height: number
}

/**
 * 摄像机视角下的画幅压暗遮罩：纯 DOM 层盖在 Canvas 之上，按当前摄像机的画幅比例
 * 压暗超出取景框的区域（容器更宽压左右、更高压上下）；pointer-events: none 不挡视口鼠标交互。
 * 容器 ref 始终挂载以保证 ResizeObserver 能可靠拿到尺寸，内容按视角/摄像机状态条件渲染。
 */
const StageAspectRatioOverlay: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 })
  const viewMode = useCameraStageStore((state) => state.viewMode)
  const objects = useCameraStageStore((state) => state.objects)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const activeCamera = getCameraObjects(objects).find((item) => item.id === activeCameraId)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const showFrame = viewMode === 'camera' && !!activeCamera && size.width > 0 && size.height > 0
  const barClassName = 'absolute bg-black/70'

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden">
      {showFrame && activeCamera && (() => {
        const targetRatio = activeCamera.aspectRatio.ratio
        const containerRatio = size.width / size.height
        if (containerRatio > targetRatio) {
          const frameWidth = size.height * targetRatio
          const barWidth = (size.width - frameWidth) / 2
          return (
            <>
              <div className={barClassName} style={{ left: 0, top: 0, width: barWidth, height: size.height }} />
              <div className={barClassName} style={{ right: 0, top: 0, width: barWidth, height: size.height }} />
            </>
          )
        }
        const frameHeight = size.width / targetRatio
        const barHeight = (size.height - frameHeight) / 2
        return (
          <>
            <div className={barClassName} style={{ left: 0, top: 0, width: size.width, height: barHeight }} />
            <div className={barClassName} style={{ left: 0, bottom: 0, width: size.width, height: barHeight }} />
          </>
        )
      })()}
    </div>
  )
}

export default StageAspectRatioOverlay
