import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { sampleCameraEffectorOffsets } from '../domain/cameraEffectors'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import type { RenderCameraScheduleEntry } from '../domain/renderCameraSchedule'
import {
  readCameraStagePlaybackRuntime,
  subscribeCameraStagePlaybackRuntime,
} from './playbackRuntime'
import { resolveStageViewportCameraId } from './viewportCameraRuntime'

interface StageViewportCameraProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
  interactionRef: React.MutableRefObject<boolean>
  cameraObjects: StageCameraObject[]
  lookAtTargets: ReadonlyMap<string, StageVec3>
  renderCameraSchedule: RenderCameraScheduleEntry[] | null
  fallbackCameraId: string | null
}

interface RuntimeCameraSample {
  object: StageCameraObject
  position: StageVec3
  rotation: StageVec3
  fov: number
}

function createRuntimeCameraSample(
  object: StageCameraObject,
  lookAtTarget: StageVec3,
): RuntimeCameraSample {
  return {
    object,
    position: object.transform.position,
    rotation: object.lookAt.mode === 'object'
      ? rotationFromPositionAndTarget(
        object.transform.position,
        lookAtTarget,
        object.transform.rotation.z,
      )
      : object.transform.rotation,
    fov: object.fov,
  }
}

/** 摄像机视角真实渲染相机；在 gl.render 前从会话 runtime 选择并应用同一帧机位。 */
const StageViewportCamera: React.FC<StageViewportCameraProps> = ({
  cameraObject,
  lookAtTarget,
  interactionRef,
  cameraObjects,
  lookAtTargets,
  renderCameraSchedule,
  fallbackCameraId,
}) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null)
  const samplesRef = useRef(new Map<string, RuntimeCameraSample>())
  const fallbackSample = useMemo(
    () => createRuntimeCameraSample(cameraObject, lookAtTarget),
    [cameraObject, lookAtTarget],
  )

  const applyRuntimeCamera = useCallback((time: number): void => {
    const camera = cameraRef.current
    if (!camera || interactionRef.current) return
    const scheduledId = resolveStageViewportCameraId(
      renderCameraSchedule,
      cameraObject.id,
      fallbackCameraId,
      time,
    )
    const sample = (scheduledId ? samplesRef.current.get(scheduledId) : null) ?? fallbackSample
    const { position, rotation, object, fov } = sample
    camera.position.set(position.x, position.y, position.z)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(
      rotation.x * Math.PI / 180,
      rotation.y * Math.PI / 180,
      rotation.z * Math.PI / 180,
    )
    camera.fov = fov
    const { positionOffset, rotationOffset } = sampleCameraEffectorOffsets(object.effectors, time)
    camera.translateX(positionOffset.x)
    camera.translateY(positionOffset.y)
    camera.translateZ(positionOffset.z)
    camera.rotateX(rotationOffset.x)
    camera.rotateY(rotationOffset.y)
    camera.rotateZ(rotationOffset.z)
    camera.updateProjectionMatrix()
  }, [cameraObject.id, fallbackCameraId, fallbackSample, interactionRef, renderCameraSchedule])

  useLayoutEffect(() => {
    const next = new Map<string, RuntimeCameraSample>()
    for (const object of cameraObjects) {
      const target = lookAtTargets.get(object.id)
      if (target) next.set(object.id, createRuntimeCameraSample(object, target))
    }
    samplesRef.current = next
    // 离屏导出用 flushSync seek 后会立即抓图，不能等待下一次 RAF 才把样本落到真实相机。
    applyRuntimeCamera(readCameraStagePlaybackRuntime().time)
  }, [applyRuntimeCamera, cameraObjects, lookAtTargets])

  useEffect(() => {
    const unregs = cameraObjects.flatMap((object) => [
      registerPlaybackApplier(object.id, 'transform.position', (value, time) => {
        const sample = samplesRef.current.get(object.id)
        if (sample) sample.position = value as StageVec3
        applyRuntimeCamera(time)
      }),
      registerPlaybackApplier(object.id, 'transform.rotation', (value, time) => {
        const sample = samplesRef.current.get(object.id)
        if (sample) sample.rotation = value as StageVec3
        applyRuntimeCamera(time)
      }),
      registerPlaybackApplier(object.id, 'fov', (value, time) => {
        const sample = samplesRef.current.get(object.id)
        if (sample) sample.fov = value as number
        applyRuntimeCamera(time)
      }),
    ])
    return () => unregs.forEach((unregister) => unregister())
  }, [applyRuntimeCamera, cameraObjects])

  // 机位边界即使没有任何属性轨道，也要在 seek/runtime publish 时切换真实相机。
  useEffect(() => subscribeCameraStagePlaybackRuntime((runtime) => {
    applyRuntimeCamera(runtime.time)
  }), [applyRuntimeCamera])

  // drei OrbitControls 在 -1 更新；播放驱动 -2 先采样，本订阅 -0.5 再重放权威姿态，
  // 最后才进入 gl.render。这样 controls 不会覆盖 roll/效果器，相机切换也不依赖 React commit。
  useFrame(() => {
    applyRuntimeCamera(readCameraStagePlaybackRuntime().time)
  }, -0.5)

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      fov={cameraObject.fov}
      near={0.05}
      far={1000}
      position={[
        cameraObject.transform.position.x,
        cameraObject.transform.position.y,
        cameraObject.transform.position.z,
      ]}
    />
  )
}

export default StageViewportCamera
