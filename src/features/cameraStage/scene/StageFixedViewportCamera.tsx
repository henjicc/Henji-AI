import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrthographicCamera } from 'three'
import type { StageFixedView } from '../viewport/viewportTypes'

interface FixedViewPose {
  position: readonly [number, number, number]
  up: readonly [number, number, number]
}

const FIXED_VIEW_POSES: Record<StageFixedView, FixedViewPose> = {
  top: { position: [0, 20, 0], up: [0, 0, -1] },
  bottom: { position: [0, -20, 0], up: [0, 0, 1] },
  front: { position: [0, 0, 20], up: [0, 1, 0] },
  back: { position: [0, 0, -20], up: [0, 1, 0] },
  left: { position: [-20, 0, 0], up: [0, 1, 0] },
  right: { position: [20, 0, 0], up: [0, 1, 0] },
}

interface StageFixedViewportCameraProps {
  view: StageFixedView
}

/** 把正交相机严格对齐世界轴；仅移动相机位置不会改变 three.js 默认的 -Z 朝向。 */
const StageFixedViewportCamera: React.FC<StageFixedViewportCameraProps> = ({ view }) => {
  const camera = useThree((state) => state.camera) as OrthographicCamera

  useLayoutEffect(() => {
    const pose = FIXED_VIEW_POSES[view]
    camera.position.fromArray(pose.position)
    camera.up.fromArray(pose.up)
    camera.lookAt(new Vector3(0, 0, 0))
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
  }, [camera, view])

  return null
}

export default StageFixedViewportCamera
