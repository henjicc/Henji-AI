import { useFrame } from '@react-three/fiber'
import type { Vector3 } from 'three'
import { setDirectorView } from './directorViewState'

/** OrbitControls 在 r3f 状态里暴露的最小可用形状（drei makeDefault 注册），与 StageFocusController 读法一致 */
interface TrackableControls {
  target: Vector3
}

/**
 * 自由视角相机状态追踪：每帧把当前相机位置/OrbitControls 注视点写入模块级缓存，
 * 供新建摄像机取「当前视图」做默认取景用；不挂 ref，直接读 r3f 默认 controls。
 */
const DirectorViewTracker: React.FC = () => {
  useFrame((rootState) => {
    const camera = rootState.camera
    const controls = (rootState as unknown as { controls?: TrackableControls }).controls
    setDirectorView({
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: controls
        ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
        : { x: 0, y: 0, z: 0 },
    })
  })

  return null
}

export default DirectorViewTracker
