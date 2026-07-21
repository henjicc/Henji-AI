import React, { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { cameraTargetFromPositionRotation, rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { beginHistorySession, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'

const DEG2RAD = Math.PI / 180

interface StageCameraViewControlsProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
  interactionRef: React.MutableRefObject<boolean>
}

/**
 * 摄像机视角下的鼠标交互：左键环绕/右键平移/滚轮推拉都是 OrbitControls 默认映射，不需要
 * 自定义按键逻辑；交互过程实时把相机位置/注视目标写回该摄像机的正式数据（等同于在属性
 * 面板改数值或拖 gizmo），一次拖拽合并为一条撤销记录。只在 lookAt.mode === 'manual' 时
 * 挂载——锁定对象模式下朝向由目标对象驱动，交互语义不清晰，维持只读。
 */
const StageCameraViewControls: React.FC<StageCameraViewControlsProps> = ({ cameraObject, lookAtTarget, interactionRef }) => {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  // OrbitControls 的 change 事件不仅来自用户拖拽——播放头 scrub 采样驱动相机移动、
  // 下方 effect 的 controls.update() 都会触发。写回 store 必须限定在用户交互期间
  //（start~end 之间），否则 scrub 会把采样值当成用户编辑一路写回（自动关键帧开启时
  // 表现为拖动播放头疯狂插关键帧）。
  const updateCameraView = useCameraStageStore((state) => state.updateCameraView)
  const prepareSimpleEdit = useCameraStageStore((state) => state.prepareSimpleEdit)
  // drei 的 OrbitControls 在默认相机切换时会整体重建实例（新实例 target 回到原点）。
  // 订阅 r3f 注册的当前实例并纳入下方 effect 依赖，保证重建后立刻重新对齐注视点，
  // 否则新建工程后的第一次拖拽会突然从 (0,0,0) 环绕（画面瞬间跳变）。
  const registeredControls = useThree((state) => state.controls)
  const controlTarget = useMemo(() => {
    const position = cameraObject.transform.position
    const distance = Math.hypot(
      lookAtTarget.x - position.x,
      lookAtTarget.y - position.y,
      lookAtTarget.z - position.z,
    )
    // 过渡采样会更新 position/rotation，但 lookAt 快照不是独立动画轨道。
    // 以当前实际旋转反推 OrbitControls 目标，避免 pointerdown 时按陈旧目标重新 lookAt。
    return cameraTargetFromPositionRotation(position, cameraObject.transform.rotation, distance)
  }, [cameraObject.transform.position, cameraObject.transform.rotation, lookAtTarget])

  // 外部改动（属性面板改坐标、切换取景摄像机、controls 实例重建）后，把环绕基准点对齐到最新目标点
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (interactionRef.current) return
    controls.target.set(controlTarget.x, controlTarget.y, controlTarget.z)
    controls.update()
    if (cameraObject.lookAt.mode === 'manual') {
      const rotation = cameraObject.transform.rotation
      // 旋转数据是 YXZ 语义，必须先声明顺序再回放，否则俯仰+水平组合会被分解出假 roll
      controls.object.rotation.order = 'YXZ'
      controls.object.rotation.set(rotation.x * DEG2RAD, rotation.y * DEG2RAD, rotation.z * DEG2RAD)
    } else {
      controls.object.rotateZ(cameraObject.transform.rotation.z * DEG2RAD)
    }
  }, [
    cameraObject.id,
    cameraObject.lookAt.mode,
    cameraObject.transform.rotation,
    interactionRef,
    controlTarget.x,
    controlTarget.y,
    controlTarget.z,
    registeredControls,
  ])

  const handleStart = (): void => {
    interactionRef.current = true
    beginHistorySession()
    prepareSimpleEdit(cameraObject.id)
  }

  const handleEnd = (): void => {
    interactionRef.current = false
    endHistorySession()
  }

  const handleChange = (): void => {
    if (!interactionRef.current) return
    const controls = controlsRef.current
    if (!controls) return
    const camera = controls.object
    const { target } = controls
    const position = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
    const lookAtTarget = { x: target.x, y: target.y, z: target.z }
    // OrbitControls 交互后相机姿态恒等于 lookAt(target)，直接用领域函数由位置+目标换算
    // 俯仰/水平角（不读 three.js 欧拉分量，避免依赖其分解顺序）；Z 轴 roll 保留现值
    updateCameraView(cameraObject.id, {
      position,
      rotation: rotationFromPositionAndTarget(position, lookAtTarget, cameraObject.transform.rotation.z),
      lookAtTarget,
    })
  }

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={false}
      onStart={handleStart}
      onEnd={handleEnd}
      onChange={handleChange}
    />
  )
}

export default StageCameraViewControls
