import type { StageCameraObject, StageObject, StageVec3 } from './sceneTypes'

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
