import { v4 as uuidv4 } from 'uuid'
import { BLACK_HEX, CAMERA_STAGE_COLOR_HEX, CAMERA_STAGE_OBJECT_PALETTE_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { createPoseMotion } from './characterMotion'
import { DEFAULT_STAGE_RENDER_STYLE } from './renderStyles'
import { POSE_PRESETS } from './posePresets.gen'
import { clonePose, createEmptyPose } from './poseTypes'
import { rotationFromPositionAndTarget } from './cameraUtils'
import type {
  StageCameraAspectRatioPreset,
  StageCameraObject,
  StageCharacterObject,
  StageGroundPattern,
  StagePrimitiveKind,
  StagePrimitiveObject,
  StageSceneSettings,
  StageTransform,
  StageVec3,
} from './sceneTypes'

/** 几何体类型的中文显示名（对齐参考产品的几何体库范围） */
export const PRIMITIVE_KIND_LABELS: Record<StagePrimitiveKind, string> = {
  box: '立方体',
  sphere: '球体',
  cylinder: '圆柱体',
  cone: '圆锥',
  pyramid: '棱锥',
  torus: '环状体',
}

export const PRIMITIVE_KINDS: StagePrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus']

/** 摄像机画幅比例预设表：ratio 为 null 表示"自定义"，由用户手动输入宽高再算 */
export const CAMERA_ASPECT_RATIO_PRESETS: Array<{
  value: StageCameraAspectRatioPreset
  label: string
  ratio: number | null
}> = [
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: 'custom', label: '自定义', ratio: null },
]

export const GROUND_PATTERN_OPTIONS: Array<{ value: StageGroundPattern; label: string }> = [
  { value: 'none', label: '纯色' },
  { value: 'grid', label: '网格' },
  { value: 'checker', label: '棋盘' },
]

export function createIdentityTransform(): StageTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }
}

/** 按已有对象数量轮换取默认颜色，避免新对象千篇一律 */
export function pickDefaultColor(objectCount: number): string {
  return CAMERA_STAGE_OBJECT_PALETTE_HEX[objectCount % CAMERA_STAGE_OBJECT_PALETTE_HEX.length]
}

export function createPrimitiveObject(
  kind: StagePrimitiveKind,
  name: string,
  color: string,
): StagePrimitiveObject {
  const transform = createIdentityTransform()
  // 几何体默认落在地面上方而不是嵌进地面
  transform.position.y = kind === 'torus' ? 0.75 : 0.5
  return { id: uuidv4(), type: 'primitive', kind, name, transform, color, visible: true }
}

export function createCharacterObject(name: string, color: string): StageCharacterObject {
  // 新角色默认用"站立"预设而不是绑定姿态（T-pose），更贴近摆拍的起点
  const standPreset = POSE_PRESETS.find((item) => item.id === 'stand')
  return {
    id: uuidv4(),
    type: 'character',
    name,
    transform: createIdentityTransform(),
    color,
    visible: true,
    variant: 'standard',
    pose: standPreset ? clonePose(standPreset) : createEmptyPose(),
    motion: createPoseMotion(),
  }
}

export function createCameraObject(
  name: string,
  color: string,
  initialView?: { position: StageVec3; target: StageVec3 },
): StageCameraObject {
  const transform = createIdentityTransform()
  transform.position = initialView ? { ...initialView.position } : { x: 0, y: 1.5, z: 4 }
  const target = initialView ? { ...initialView.target } : { x: 0, y: 1, z: 0 }
  transform.rotation = rotationFromPositionAndTarget(transform.position, target)
  return {
    id: uuidv4(),
    type: 'camera',
    name,
    transform,
    color,
    visible: true,
    fov: 50,
    lookAt: { mode: 'manual', target },
    aspectRatio: { preset: '16:9', ratio: 16 / 9 },
    effectors: [],
  }
}

export function createDefaultSceneSettings(): StageSceneSettings {
  return {
    ground: {
      color: CAMERA_STAGE_COLOR_HEX.groundBase,
      pattern: 'grid',
      density: 10,
      gridLineColor: CAMERA_STAGE_COLOR_HEX.gridSection,
      gridLineThickness: 0.9,
      checkerLightColor: WHITE_HEX,
      checkerDarkColor: BLACK_HEX,
    },
    sky: {
      color: CAMERA_STAGE_COLOR_HEX.stageBg,
    },
    sunlight: {
      enabled: true,
      intensity: 1,
      timeOfDay: 12,
    },
    fog: {
      enabled: true,
      distance: 90,
    },
    render: {
      style: DEFAULT_STAGE_RENDER_STYLE,
    },
    display: {
      showNameLabels: false,
      nameLabel: {
        textColor: WHITE_HEX,
        backgroundColor: CAMERA_STAGE_COLOR_HEX.groundBase,
        backgroundOpacity: 0.9,
        followObjectColor: false,
        scale: 1,
        offset: { x: 0, y: 0.18, z: 0 },
        shadowColor: BLACK_HEX,
        shadowOpacity: 0.45,
        shadowBlur: 6,
        shadowDistance: 2,
        shadowAngle: 90,
      },
    },
  }
}
