import type { StageVec3 } from '../domain/sceneTypes'

/**
 * 自由视角最近一次相机位置/注视点的模块级缓存（非 store 状态，避免每帧触发订阅重渲染）。
 * 供 store 的 addCamera 在 R3F 场景之外读取，作为新建摄像机的默认取景依据。
 */

export interface DirectorViewSnapshot {
  position: StageVec3
  target: StageVec3
}

/** 标准初始视角：正对场景原点（水平角为 0）、略俯视，网格在画面中左右对称、横向线保持水平 */
export const DEFAULT_DIRECTOR_VIEW: DirectorViewSnapshot = {
  position: { x: 0, y: 4.2, z: 9 },
  target: { x: 0, y: 1, z: 0 },
}

const DIRECTOR_VIEW_STORAGE_KEY = 'camera-stage-director-view'

function cloneDirectorView(snapshot: DirectorViewSnapshot): DirectorViewSnapshot {
  return { position: { ...snapshot.position }, target: { ...snapshot.target } }
}

function isStageVec3(input: unknown): input is StageVec3 {
  if (!input || typeof input !== 'object') return false
  const record = input as Record<string, unknown>
  return ['x', 'y', 'z'].every((axis) => typeof record[axis] === 'number' && Number.isFinite(record[axis]))
}

function parseDirectorViewSnapshot(input: unknown): DirectorViewSnapshot | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  return isStageVec3(record.position) && isStageVec3(record.target)
    ? { position: record.position, target: record.target }
    : null
}

function readDirectorViewFromStorage(): DirectorViewSnapshot | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(DIRECTOR_VIEW_STORAGE_KEY)
  if (!raw) return null
  try {
    return parseDirectorViewSnapshot(JSON.parse(raw))
  } catch {
    return null
  }
}

let current: DirectorViewSnapshot | null = readDirectorViewFromStorage()

export function setDirectorView(snapshot: DirectorViewSnapshot): void {
  current = snapshot
}

/** 新建工程时调用：不继承上一次离开时的自由视角，回到标准正视角度 */
export function resetDirectorView(): void {
  current = cloneDirectorView(DEFAULT_DIRECTOR_VIEW)
}

export function getDirectorView(): DirectorViewSnapshot | null {
  return current
}

export function persistDirectorView(): void {
  if (typeof localStorage === 'undefined' || !current) return
  localStorage.setItem(DIRECTOR_VIEW_STORAGE_KEY, JSON.stringify(current))
}
