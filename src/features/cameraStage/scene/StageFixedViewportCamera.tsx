import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrthographicCamera } from 'three'
import type { StageFixedView } from '../viewport/viewportTypes'
import { STAGE_FIXED_VIEW_DISTANCE } from './stageClipPlanes'

interface FixedViewPose {
  /** 相机所在的方向（单位向量），距离统一取 STAGE_FIXED_VIEW_DISTANCE */
  direction: readonly [number, number, number]
  up: readonly [number, number, number]
}

const FIXED_VIEW_POSES: Record<StageFixedView, FixedViewPose> = {
  top: { direction: [0, 1, 0], up: [0, 0, -1] },
  bottom: { direction: [0, -1, 0], up: [0, 0, 1] },
  front: { direction: [0, 0, 1], up: [0, 1, 0] },
  back: { direction: [0, 0, -1], up: [0, 1, 0] },
  left: { direction: [-1, 0, 0], up: [0, 1, 0] },
  right: { direction: [1, 0, 0], up: [0, 1, 0] },
}

interface StageFixedViewportCameraProps {
  view: StageFixedView
}

/** 把正交相机严格对齐世界轴；仅移动相机位置不会改变 three.js 默认的 -Z 朝向。 */
const StageFixedViewportCamera: React.FC<StageFixedViewportCameraProps> = ({ view }) => {
  const camera = useThree((state) => state.camera) as OrthographicCamera

  useLayoutEffect(() => {
    const pose = FIXED_VIEW_POSES[view]
    camera.position.fromArray(pose.direction).multiplyScalar(STAGE_FIXED_VIEW_DISTANCE)
    camera.up.fromArray(pose.up)
    camera.lookAt(new Vector3(0, 0, 0))
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
  }, [camera, view])

  return null
}

export default StageFixedViewportCamera
