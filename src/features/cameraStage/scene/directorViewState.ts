import type { StageVec3 } from '../domain/sceneTypes'

/**
 * 自由视角最近一次相机位置/注视点的模块级缓存（非 store 状态，避免每帧触发订阅重渲染）。
 * 供 store 的 addCamera 在 R3F 场景之外读取，作为新建摄像机的默认取景依据。
 */

export interface DirectorViewSnapshot {
  position: StageVec3
  target: StageVec3
}

let current: DirectorViewSnapshot | null = null

export function setDirectorView(snapshot: DirectorViewSnapshot): void {
  current = snapshot
}

export function getDirectorView(): DirectorViewSnapshot | null {
  return current
}
