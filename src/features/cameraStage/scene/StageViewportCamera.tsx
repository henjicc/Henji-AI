import React, { useLayoutEffect, useRef } from 'react'
import { PerspectiveCamera } from '@react-three/drei'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'

interface StageViewportCameraProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
}

/** 机位视角真实渲染相机：位置/FOV/lookAt 完全来自当前机位对象数据 */
const StageViewportCamera: React.FC<StageViewportCameraProps> = ({ cameraObject, lookAtTarget }) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null)
  const { position } = cameraObject.transform

  useLayoutEffect(() => {
    const camera = cameraRef.current
    if (!camera) return
    camera.position.set(position.x, position.y, position.z)
    camera.fov = cameraObject.fov
    camera.lookAt(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z)
    camera.updateProjectionMatrix()
  }, [
    cameraObject.fov,
    lookAtTarget.x,
    lookAtTarget.y,
    lookAtTarget.z,
    position.x,
    position.y,
    position.z,
  ])

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      fov={cameraObject.fov}
      near={0.05}
      far={1000}
      position={[position.x, position.y, position.z]}
    />
  )
}

export default StageViewportCamera
