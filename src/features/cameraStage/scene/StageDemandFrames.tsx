import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { subscribeCameraMotion } from '../application/cameraMotionDraft'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageToolStore } from '../store/cameraStageToolStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'
import { subscribeCameraStagePlaybackRuntime } from './playbackRuntime'

/**
 * 按需渲染的出帧来源（Canvas 设为 frameloop="demand"）。
 *
 * - 播放运行时每次推进、seek、暂停都会发布：播放中主驱动逐帧推进，这里让每个窗格都跟着出帧。
 * - store 变化：React 提交后 R3F 改属性会自动请求一帧，但不少组件在 effect 里直接改 three 对象
 *   （地面着色参数、摄像机控制器目标等）。这些 effect 可能落在已请求的那一帧之后，所以 store
 *   变化后再补一帧，保证 effect 的结果也画出来。
 * - 控制器交互（OrbitControls、TransformControls）各自在 change 事件里请求帧。
 */
const StageDemandFrames: React.FC = () => {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    let trailingFrame: number | null = null
    const invalidateAfterCommit = (): void => {
      invalidate()
      if (trailingFrame !== null) return
      trailingFrame = window.requestAnimationFrame(() => {
        trailingFrame = null
        invalidate()
      })
    }
    const unsubscribes = [
      subscribeCameraStagePlaybackRuntime(() => invalidate()),
      useCameraStageStore.subscribe(invalidateAfterCommit),
      useCameraStageToolStore.subscribe(invalidateAfterCommit),
      useCameraStageViewportStore.subscribe(invalidateAfterCommit),
      subscribeCameraMotion(invalidateAfterCommit),
    ]
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
      if (trailingFrame !== null) window.cancelAnimationFrame(trailingFrame)
    }
  }, [invalidate])

  return null
}

export default StageDemandFrames
