/**
 * 运镜设备预设（纯数据与纯函数）。
 *
 * 设备决定三件事：运动上限（速度、加速度、加加速度）、惯性手感（拐角与衔接融合多长时间、注视跟随滞后多少），
 * 以及设备自带的晃动。数值取自常见设备的实拍量级，用于判断“这台设备在这么长时间里跑不跑得完”，
 * 不是厂商规格：轨道车推轨一般不超过 1.5 米/秒、起停很柔；摇臂臂端能到 2–3 米/秒但质量大、加速慢；
 * 斯坦尼康以步行速度为主、带轻微漂浮；航拍无人机速度高、云台滤波让朝向跟得更慢；手持起步快、有呼吸与手抖。
 *
 * 未指定设备（free）保持各段速度预设原样，只在衔接处做连续，不设上限、不加滞后与晃动。
 */

import type { StageCameraEffector } from './stateKeyframeTypes'
import type { StageCameraObject, StageCameraRig } from './sceneTypes'

export interface StageCameraRigPreset {
  id: StageCameraRig
  label: string
  /** 米/秒 */
  maxSpeed: number
  /** 米/秒² */
  maxAcceleration: number
  /** 米/秒³ */
  maxJerk: number
  /** 拐角与衔接融合用时（秒）：越大转向越缓，越像有分量的设备。 */
  blendTime: number
  /** 注视跟随滞后（秒）：匀速摇镜时镜头比理想朝向晚这么久；0 = 镜头始终正对注视目标。 */
  aimLag: number
  /** 设备自带晃动；与摄像机上挂的效果器叠加。 */
  shake?: Omit<StageCameraEffector, 'id' | 'enabled'>
}

/** 注视跟随滞后上限（秒）：再慢镜头就跟丢主体了。 */
export const STAGE_CAMERA_AIM_LAG_MAX = 2

export const STAGE_CAMERA_RIG_IDS = ['free', 'dolly', 'crane', 'steadicam', 'drone', 'handheld'] as const satisfies readonly StageCameraRig[]

export const STAGE_CAMERA_RIG_PRESETS: Record<StageCameraRig, StageCameraRigPreset> = {
  free: { id: 'free', label: '不模拟设备', maxSpeed: Infinity, maxAcceleration: Infinity, maxJerk: Infinity, blendTime: 1.2, aimLag: 0 },
  dolly: { id: 'dolly', label: '轨道车', maxSpeed: 1.5, maxAcceleration: 0.6, maxJerk: 1.5, blendTime: 1.5, aimLag: 0.1 },
  crane: { id: 'crane', label: '摇臂', maxSpeed: 2.5, maxAcceleration: 0.5, maxJerk: 0.8, blendTime: 2, aimLag: 0.15 },
  steadicam: {
    id: 'steadicam', label: '斯坦尼康', maxSpeed: 3, maxAcceleration: 1.2, maxJerk: 3, blendTime: 1.2, aimLag: 0.2,
    shake: { kind: 'handheld', intensity: 0.25, frequency: 0.35 },
  },
  drone: { id: 'drone', label: '无人机', maxSpeed: 12, maxAcceleration: 3, maxJerk: 6, blendTime: 1.8, aimLag: 0.25 },
  handheld: {
    id: 'handheld', label: '手持', maxSpeed: 2.5, maxAcceleration: 2, maxJerk: 10, blendTime: 0.8, aimLag: 0.12,
    shake: { kind: 'handheld', intensity: 0.7, frequency: 1.4 },
  },
}

export function isStageCameraRig(value: unknown): value is StageCameraRig {
  return typeof value === 'string' && (STAGE_CAMERA_RIG_IDS as readonly string[]).includes(value)
}

export function resolveCameraRigPreset(rig: StageCameraRig | undefined): StageCameraRigPreset {
  return STAGE_CAMERA_RIG_PRESETS[rig ?? 'free']
}

/** 摄像机实际使用的注视跟随滞后：显式设置优先，否则取设备默认。 */
export function resolveCameraAimLag(camera: Pick<StageCameraObject, 'rig' | 'aimLag'>): number {
  const value = camera.aimLag ?? resolveCameraRigPreset(camera.rig).aimLag
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 摄像机上挂的效果器，加上设备自带的晃动。 */
export function resolveCameraEffectors(camera: Pick<StageCameraObject, 'rig' | 'effectors'>): StageCameraEffector[] {
  const shake = resolveCameraRigPreset(camera.rig).shake
  return shake ? [...camera.effectors, { id: `rig:${camera.rig}`, enabled: true, ...shake }] : camera.effectors
}
