import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { PerspectiveCamera } from '@react-three/drei'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'

interface StageViewportCameraProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
}

/** 机位视角真实渲染相机：位置/FOV/lookAt 完全来自当前机位对象数据 */
const StageViewportCamera: React.FC<StageViewportCameraProps> = ({ cameraObject, lookAtTarget }) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null)
  const { position } = cameraObject.transform

  // 播放期命令式采样：机位视角下真实渲染相机的位置/FOV 直接由采样值驱动（不写 store）
  useEffect(() => {
    const unregs: Array<() => void> = []
    unregs.push(
      registerPlaybackApplier(cameraObject.id, 'transform.position', (value) => {
        const camera = cameraRef.current
        if (!camera) return
        const v = value as StageVec3
        camera.position.set(v.x, v.y, v.z)
        camera.lookAt(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z)
        camera.updateProjectionMatrix()
      }),
    )
    unregs.push(
      registerPlaybackApplier(cameraObject.id, 'fov', (value) => {
        const camera = cameraRef.current
        if (!camera) return
        camera.fov = value as number
        camera.updateProjectionMatrix()
      }),
    )
    return () => unregs.forEach((unregister) => unregister())
  }, [cameraObject.id, lookAtTarget.x, lookAtTarget.y, lookAtTarget.z])

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
