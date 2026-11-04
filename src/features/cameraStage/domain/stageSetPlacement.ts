import type { CameraStageSetParams } from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

/*
 * 布景局部坐标 → 场景坐标：楼体对象与装饰实例都按这一份换算，二者才不会错位。
 * 与 three.js 绕 Y 轴旋转同向，物体自身朝向加上同一个角度。
 */

export interface StageSetPlacement {
  centerX: number
  centerZ: number
  cos: number
  sin: number
  /** 布景朝向（度） */
  rotation: number
}

export function stageSetPlacement(params: Pick<CameraStageSetParams, 'center' | 'rotation'>): StageSetPlacement {
  const radians = (params.rotation * Math.PI) / 180
  return { centerX: params.center.x, centerZ: params.center.z, cos: Math.cos(radians), sin: Math.sin(radians), rotation: params.rotation }
}

export function stageSetToWorld(placement: StageSetPlacement, x: number, z: number): { x: number; z: number } {
  return {
    x: placement.centerX + x * placement.cos + z * placement.sin,
    z: placement.centerZ - x * placement.sin + z * placement.cos,
  }
}
