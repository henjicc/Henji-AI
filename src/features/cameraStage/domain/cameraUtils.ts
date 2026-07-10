import type { StageCameraObject, StageObject, StageObjectPatch, StageVec3 } from './sceneTypes'

/** 相机锁定对象时的默认瞄准点：角色看胸口附近，其它对象看自身原点/中心 */
export function getObjectLookAtPoint(object: StageObject): StageVec3 {
  const { position, scale } = object.transform
  if (object.type === 'character') {
    return { x: position.x, y: position.y + 1 * scale.y, z: position.z }
  }
  return { ...position }
}

export function resolveCameraLookAtTarget(
  camera: StageCameraObject,
  objects: StageObject[],
): StageVec3 {
  const { lookAt } = camera
  if (lookAt.mode === 'manual') {
    return { ...lookAt.target }
  }

  const target = objects.find((item) => item.id === lookAt.objectId)
  return target ? getObjectLookAtPoint(target) : { ...lookAt.fallbackTarget }
}

export function getCameraObjects(objects: StageObject[]): StageCameraObject[] {
  return objects.filter((item): item is StageCameraObject => item.type === 'camera')
}

/** 校验 id 是否指向场景中一台真实存在的摄像机对象；activeCameraId 等字段写入前的通用兜底判断 */
export function isCameraId(objects: StageObject[], id: string | null | undefined): boolean {
  return !!id && objects.some((item) => item.id === id && item.type === 'camera')
}

/**
 * 首个摄像机判定（重要记录 007）：按对象数组插入顺序取最早创建的摄像机。
 * `objects` 数组本身只增不重排（新增 push 到末尾，删除用 filter，均保序），
 * 因此"数组中第一个 type==='camera' 的对象"天然等价于"创建时间最早的摄像机"，
 * 无需额外的时间戳/序号字段。
 */
export function isFirstCamera(objects: StageObject[], id: string): boolean {
  return getCameraObjects(objects)[0]?.id === id
}

/**
 * 应用对象补丁；摄像机画幅比例（aspectRatio）遵循重要记录 007 的一致性规则：
 * 首个摄像机的画幅决定全场景/导出最终画幅——只有它能编辑画幅，编辑后联动同步全部摄像机；
 * 非首摄像机的画幅补丁在这里被钳制忽略（action 层面兜底，不只是 UI 禁用），
 * 补丁中的其余字段仍正常生效。
 */
export function applyObjectPatch(objects: StageObject[], id: string, patch: StageObjectPatch): StageObject[] {
  const target = objects.find((item) => item.id === id)
  if (!target) return objects
  if (patch.aspectRatio === undefined || target.type !== 'camera') {
    return objects.map((item) => (item.id === id ? ({ ...item, ...patch } as StageObject) : item))
  }
  if (!isFirstCamera(objects, id)) {
    const { aspectRatio: _ignoredAspectRatio, ...rest } = patch
    return objects.map((item) => (item.id === id ? ({ ...item, ...rest } as StageObject) : item))
  }
  const nextAspectRatio = { ...patch.aspectRatio }
  return objects.map((item) => {
    if (item.id === id) return { ...item, ...patch, aspectRatio: nextAspectRatio } as StageObject
    if (item.type === 'camera') return { ...item, aspectRatio: { ...nextAspectRatio } }
    return item
  })
}
