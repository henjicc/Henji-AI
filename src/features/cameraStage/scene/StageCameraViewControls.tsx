import React, { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { beginHistorySession, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'

interface StageCameraViewControlsProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
}

/**
 * 摄像机视角下的鼠标交互：左键环绕/右键平移/滚轮推拉都是 OrbitControls 默认映射，不需要
 * 自定义按键逻辑；交互过程实时把相机位置/注视目标写回该摄像机的正式数据（等同于在属性
 * 面板改数值或拖 gizmo），一次拖拽合并为一条撤销记录。只在 lookAt.mode === 'manual' 时
 * 挂载——锁定角色模式下位置由跟踪逻辑驱动，交互语义不清晰，维持只读。
 */
const StageCameraViewControls: React.FC<StageCameraViewControlsProps> = ({ cameraObject, lookAtTarget }) => {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)
  const updateObject = useCameraStageStore((state) => state.updateObject)

  // 外部改动（属性面板改坐标、切换取景摄像机）后，把环绕基准点对齐到最新目标点
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.target.set(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z)
    controls.update()
  }, [lookAtTarget.x, lookAtTarget.y, lookAtTarget.z, cameraObject.id])

  const handleChange = (): void => {
    const controls = controlsRef.current
    if (!controls) return
    const camera = controls.object
    const { target } = controls
    updateTransform(cameraObject.id, {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    })
    updateObject(cameraObject.id, {
      lookAt: { mode: 'manual', target: { x: target.x, y: target.y, z: target.z } },
    })
  }

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      onStart={beginHistorySession}
      onEnd={endHistorySession}
      onChange={handleChange}
    />
  )
}

export default StageCameraViewControls
