import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { sampleCameraEffectorOffsets } from '../domain/cameraEffectors'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { useCameraStageStore } from '../store/cameraStageStore'

interface StageViewportCameraProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
  interactionRef: React.MutableRefObject<boolean>
}

/** 摄像机视角真实渲染相机：位置/FOV/lookAt 完全来自当前摄像机对象数据 */
const StageViewportCamera: React.FC<StageViewportCameraProps> = ({ cameraObject, lookAtTarget, interactionRef }) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null)
  const { position } = cameraObject.transform
  const staticRotation = useMemo(() => (
    cameraObject.lookAt.mode === 'object'
      ? rotationFromPositionAndTarget(position, lookAtTarget, cameraObject.transform.rotation.z)
      : cameraObject.transform.rotation
  ), [cameraObject.lookAt.mode, cameraObject.transform.rotation, lookAtTarget, position])
  const sampledPositionRef = useRef<StageVec3>(position)
  const sampledRotationRef = useRef<StageVec3>(staticRotation)

  const applyCameraSample = useCallback((camera: ThreePerspectiveCamera, time: number): void => {
    const basePosition = sampledPositionRef.current
    const rotation = sampledRotationRef.current
    camera.position.set(basePosition.x, basePosition.y, basePosition.z)
    // 摄像机旋转数据语义为 YXZ（先水平角 Y、再俯仰 X、最后 roll Z），与 lookAt 换算函数一致；
    // three.js 默认 XYZ 顺序回放会把俯仰+水平的组合分解出一个假 roll，表现为画面水平线倾斜
    camera.rotation.order = 'YXZ'
    camera.rotation.set(rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, rotation.z * Math.PI / 180)
    const { positionOffset, rotationOffset } = sampleCameraEffectorOffsets(cameraObject.effectors, time)
    camera.translateX(positionOffset.x)
    camera.translateY(positionOffset.y)
    camera.translateZ(positionOffset.z)
    camera.rotateX(rotationOffset.x)
    camera.rotateY(rotationOffset.y)
    camera.rotateZ(rotationOffset.z)
    camera.updateProjectionMatrix()
  }, [cameraObject.effectors])

  // OrbitControls 即使没有用户输入也会持续执行 lookAt；在它之后重放权威姿态，
  // 保证静态 scrub、空格播放和 Z 轴 roll 使用完全相同的 XYZ 数据。
  useFrame(() => {
    const camera = cameraRef.current
    if (!camera || interactionRef.current) return
    applyCameraSample(camera, useCameraStageStore.getState().playback.currentTime)
  }, -0.5)

  // 播放期命令式采样：摄像机视角下真实渲染相机的位置/FOV 直接由采样值驱动（不写 store）
  useEffect(() => {
    const unregs: Array<() => void> = []
    unregs.push(
      registerPlaybackApplier(cameraObject.id, 'transform.position', (value, time) => {
        const camera = cameraRef.current
        if (!camera) return
        sampledPositionRef.current = value as StageVec3
        applyCameraSample(camera, time)
      }),
    )
    unregs.push(
      registerPlaybackApplier(cameraObject.id, 'transform.rotation', (value, time) => {
        const camera = cameraRef.current
        if (!camera) return
        sampledRotationRef.current = value as StageVec3
        applyCameraSample(camera, time)
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
  }, [applyCameraSample, cameraObject.id])

  useLayoutEffect(() => {
    const camera = cameraRef.current
    if (!camera) return
    camera.fov = cameraObject.fov
    sampledPositionRef.current = position
    sampledRotationRef.current = staticRotation
    if (!interactionRef.current) {
      applyCameraSample(camera, useCameraStageStore.getState().playback.currentTime)
    }
  }, [
    cameraObject.fov,
    cameraObject.effectors,
    cameraObject.transform.rotation.z,
    staticRotation,
    applyCameraSample,
    interactionRef,
    lookAtTarget,
    lookAtTarget.x,
    lookAtTarget.y,
    lookAtTarget.z,
    position,
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
