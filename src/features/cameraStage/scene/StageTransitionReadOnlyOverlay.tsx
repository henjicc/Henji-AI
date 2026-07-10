import React from 'react'
import { useCameraStageStore } from '../store/cameraStageStore'
import { isTimeInTransition } from '../simple/timeline/shotClipGeometry'

/**
 * 简易模式过渡段只读提示条（重要记录 003）：播放头落在任意一张卡的过渡段内时，
 * 视口 gizmo 已在 StageScene 里隐藏，这里叠一条纯展示提示，告知用户去前/后静止块编辑。
 * 挂载位置与 StageAspectRatioOverlay 同级（CameraStageDock 的 ViewportPanel）。
 */
const StageTransitionReadOnlyOverlay: React.FC = () => {
  const editorMode = useCameraStageStore((state) => state.editorMode)
  const shots = useCameraStageStore((state) => state.shots)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const fps = useCameraStageStore((state) => state.animation.fps)
  const simpleAutoKeyframe = useCameraStageStore((state) => state.simpleAutoKeyframe)

  const show = editorMode === 'simple' && !simpleAutoKeyframe && isTimeInTransition(shots, currentTime, fps)
  if (!show) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <div className="rounded-full border border-border-dark bg-surface-dark/90 px-3 py-1 text-xs text-text-muted shadow-lg">
        过渡画面由前后片段决定，点击前后片段进行编辑
      </div>
    </div>
  )
}

export default StageTransitionReadOnlyOverlay
