import type { StageCameraEffector } from './shotTypes'
import type { StageVec3 } from './sceneTypes'

export interface CameraEffectorOffset {
  /** 摄像机局部坐标偏移：x=右、y=上、z=向后 */
  positionOffset: StageVec3
  /** 摄像机局部欧拉角偏移（弧度） */
  rotationOffset: StageVec3
}

const ZERO_VEC3: StageVec3 = { x: 0, y: 0, z: 0 }

function zeroOffset(): CameraEffectorOffset {
  return { positionOffset: { ...ZERO_VEC3 }, rotationOffset: { ...ZERO_VEC3 } }
}

/** 以时间为唯一变量采样单个摄像机效果器；无随机数、无累积状态。 */
export function sampleEffectorOffset(
  effector: StageCameraEffector,
  time: number,
): CameraEffectorOffset {
  if (!effector.enabled || effector.intensity <= 0 || effector.frequency <= 0) return zeroOffset()

  const intensity = effector.intensity
  const phase = Math.max(0, time) * effector.frequency * Math.PI * 2
  if (effector.kind === 'breathing') {
    return {
      positionOffset: { x: 0, y: 0, z: Math.sin(phase) * intensity * 0.12 },
      rotationOffset: { ...ZERO_VEC3 },
    }
  }

  return {
    positionOffset: {
      x: Math.sin(phase * 0.73 + 0.4) * intensity * 0.018,
      y: Math.sin(phase * 1.17 + 2.1) * intensity * 0.014,
      z: Math.sin(phase * 0.41 + 4.2) * intensity * 0.006,
    },
    rotationOffset: {
      x: Math.sin(phase * 0.89 + 1.3) * intensity * 0.009,
      y: Math.sin(phase * 1.31 + 3.7) * intensity * 0.012,
      z: Math.sin(phase * 0.57 + 5.1) * intensity * 0.007,
    },
  }
}

/** 按数组顺序叠加全部已启用效果器。 */
export function sampleCameraEffectorOffsets(
  effectors: StageCameraEffector[],
  time: number,
): CameraEffectorOffset {
  return effectors.reduce<CameraEffectorOffset>((total, effector) => {
    const sampled = sampleEffectorOffset(effector, time)
    return {
      positionOffset: {
        x: total.positionOffset.x + sampled.positionOffset.x,
        y: total.positionOffset.y + sampled.positionOffset.y,
        z: total.positionOffset.z + sampled.positionOffset.z,
      },
      rotationOffset: {
        x: total.rotationOffset.x + sampled.rotationOffset.x,
        y: total.rotationOffset.y + sampled.rotationOffset.y,
        z: total.rotationOffset.z + sampled.rotationOffset.z,
      },
    }
  }, zeroOffset())
}
