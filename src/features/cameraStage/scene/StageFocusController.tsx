import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { useCameraStageStore } from '../store/cameraStageStore'

/** OrbitControls 在 r3f 状态里暴露的最小可用形状（drei makeDefault 注册） */
interface FocusableControls {
  target: Vector3
  update: () => void
}

const FOCUS_LERP_FACTOR = 0.2
const FOCUS_SNAP_DISTANCE = 0.01

/**
 * 聚焦选中对象：订阅 store 的 focusToken，变化时把 OrbitControls target
 * 平滑过渡到选中对象位置（F 快捷键触发）；不挂 ref，直接读 r3f 默认 controls。
 */
const StageFocusController: React.FC = () => {
  const focusToken = useCameraStageStore((state) => state.focusToken)
  const goalRef = useRef<Vector3 | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    const state = useCameraStageStore.getState()
    const object = state.objects.find((item) => item.id === state.selectedId)
    if (!object) return
    const { position } = object.transform
    goalRef.current = new Vector3(position.x, position.y, position.z)
  }, [focusToken])

  useFrame((rootState) => {
    const goal = goalRef.current
    const controls = (rootState as unknown as { controls?: FocusableControls }).controls
    if (!goal || !controls) return
    controls.target.lerp(goal, FOCUS_LERP_FACTOR)
    controls.update()
    if (controls.target.distanceTo(goal) < FOCUS_SNAP_DISTANCE) {
      controls.target.copy(goal)
      controls.update()
      goalRef.current = null
    }
  })

  return null
}

export default StageFocusController
