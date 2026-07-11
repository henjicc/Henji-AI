import type { StageCameraObject, StageObject, StageObjectPatch, StageVec3 } from './sceneTypes'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

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

/** 由摄像机位置与注视点换算为面板可读的俯仰角 X / 水平角 Y（角度制）。 */
export function resolveCameraRotation(camera: StageCameraObject, objects: StageObject[]): StageVec3 {
  if (camera.lookAt.mode === 'manual') return { ...camera.transform.rotation }
  const target = resolveCameraLookAtTarget(camera, objects)
  return rotationFromPositionAndTarget(camera.transform.position, target, camera.transform.rotation.z)
}

/** 由位置与目标点计算 three.js 摄像机欧拉角；roll 没有包含在 lookAt 中，由调用方显式保留。 */
export function rotationFromPositionAndTarget(position: StageVec3, target: StageVec3, roll = 0): StageVec3 {
  const dx = target.x - position.x
  const dy = target.y - position.y
  const dz = target.z - position.z
  return {
    x: Math.atan2(dy, Math.hypot(dx, dz)) * RAD2DEG,
    y: Math.atan2(-dx, -dz) * RAD2DEG,
    z: roll,
  }
}

/** 按旋转角更新注视点并保持当前对焦距离；摄像机朝向仍由单一 lookAt 数据源驱动。 */
export function cameraTargetFromRotation(
  camera: StageCameraObject,
  objects: StageObject[],
  rotation: StageVec3,
): StageVec3 {
  const currentTarget = resolveCameraLookAtTarget(camera, objects)
  const position = camera.transform.position
  const distance = Math.max(0.01, Math.hypot(
    currentTarget.x - position.x,
    currentTarget.y - position.y,
    currentTarget.z - position.z,
  ))
  const pitch = rotation.x * DEG2RAD
  const yaw = rotation.y * DEG2RAD
  const horizontal = Math.cos(pitch) * distance
  return {
    x: position.x - Math.sin(yaw) * horizontal,
    y: position.y + Math.sin(pitch) * distance,
    z: position.z - Math.cos(yaw) * horizontal,
  }
}

export function getCameraObjects(objects: StageObject[]): StageCameraObject[] {
  return objects.filter((item): item is StageCameraObject => item.type === 'camera')
}

/**
 * 校验一组参与渲染的摄像机是否使用同一画幅。正常工程由首摄像机画幅规则保证此不变量；
 * 本函数仅为旧工程数据或未来写入口遗漏时的导出前防御性兜底，不参与画幅的业务写入。
 */
export function areCameraAspectRatiosConsistent(cameras: StageCameraObject[]): boolean {
  const referenceRatio = cameras[0]?.aspectRatio.ratio
  if (referenceRatio === undefined) return true
  if (!Number.isFinite(referenceRatio)) return false
  return cameras.every((camera) => (
    Number.isFinite(camera.aspectRatio.ratio)
    && Math.abs(camera.aspectRatio.ratio - referenceRatio) < Number.EPSILON
  ))
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
