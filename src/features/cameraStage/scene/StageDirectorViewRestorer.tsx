import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Vector3 } from 'three'
import { DEFAULT_DIRECTOR_VIEW, getDirectorView } from './directorViewState'

interface RestorableControls {
  target: Vector3
  update: () => void
}

/**
 * 自由视角恢复器：在 OrbitControls 就绪后，仅首帧把上次退出时的相机位置/注视点补回去。
 * 这样重新进入3D 镜头参考时，自由视角能续上用户离开前的观察角度。
 * 没有历史快照（首次使用/新建工程重置后）时落到标准正视角度，而不是保留 Canvas 兜底机位。
 */
const StageDirectorViewRestorer: React.FC = () => {
  const restoredRef = useRef(false)
  const snapshotRef = useRef(getDirectorView() ?? DEFAULT_DIRECTOR_VIEW)

  useFrame((rootState) => {
    if (restoredRef.current) return
    const snapshot = snapshotRef.current
    const controls = (rootState as unknown as { controls?: RestorableControls }).controls
    if (!controls) return
    rootState.camera.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z)
    controls.target.set(snapshot.target.x, snapshot.target.y, snapshot.target.z)
    controls.update()
    restoredRef.current = true
  })

  return null
}

export default StageDirectorViewRestorer
