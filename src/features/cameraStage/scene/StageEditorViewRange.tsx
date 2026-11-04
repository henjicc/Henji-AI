import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Fog, PerspectiveCamera, Vector3 } from 'three'
import type { StageSceneExtent } from '../application/stageSceneExtent'
import { resolveFixedViewFar, resolveStageClipPlanes } from './stageClipPlanes'
import { directorMaxPolarAngle } from './directorViewState'

interface OrbitTarget {
  target: Vector3
  maxPolarAngle: number
}

interface StageEditorViewRangeProps {
  extent: StageSceneExtent
  fixedView: boolean
  /** 场景设置给出的雾起止距离；关雾时为 null */
  fog: { near: number; far: number } | null
}

/**
 * 编辑视角（自由透视与正交视图）的看得见范围。
 *
 * 裁剪面随相机与场景尺度每帧更新；环绕不能把机位转到地面以下；雾按“离环绕中心多远”往后推：雾是成片的外观，
 * 在摄像机画面里照原值生效，但编辑时拉远看全景，原值会让整个场景都淡进天空。
 *
 * 挂在聚焦与视角恢复之后：同一帧里它们改过的机位，这里读到的已是最新的。
 */
const StageEditorViewRange: React.FC<StageEditorViewRangeProps> = ({ extent, fixedView, fog }) => {
  const propsRef = useRef({ extent, fixedView, fog })
  propsRef.current = { extent, fixedView, fog }

  useFrame((rootState) => {
    const { extent: currentExtent, fixedView: fixed, fog: baseFog } = propsRef.current
    const camera = rootState.camera
    const controls = (rootState as unknown as { controls?: OrbitTarget }).controls
    const focusDistance = controls ? camera.position.distanceTo(controls.target) : 0

    if (fixed) {
      const far = resolveFixedViewFar(currentExtent)
      if (camera.far !== far) {
        camera.far = far
        camera.updateProjectionMatrix()
      }
      return
    }

    if (controls) controls.maxPolarAngle = directorMaxPolarAngle(controls.target.y, focusDistance)
    const planes = resolveStageClipPlanes(camera.position, focusDistance, currentExtent)
    const perspective = camera as PerspectiveCamera
    if (perspective.near !== planes.near || perspective.far !== planes.far) {
      perspective.near = planes.near
      perspective.far = planes.far
      perspective.updateProjectionMatrix()
    }
    const sceneFog = rootState.scene.fog as Fog | null
    if (sceneFog && baseFog) {
      sceneFog.near = baseFog.near + focusDistance
      sceneFog.far = baseFog.far + focusDistance
    }
  })

  return null
}

export default StageEditorViewRange
