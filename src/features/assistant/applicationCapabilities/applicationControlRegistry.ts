import {
  ApplicationControlExecutionEngine,
  ApplicationReflectionRegistry,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import {
  createSettingsReflectionRegistration,
  SettingsMutationExecutor,
} from '@/features/settings/application-control'
import { createCameraStageReflectionRegistrations } from '@/features/cameraStage/application/cameraStageReflection'
import {
  CAMERA_STAGE_MUTATION_ENTITY_TYPES,
  type CameraStageControlExecutorDependencies,
  CameraStageMotionOperationExecutor,
  CameraStageMutationExecutor,
} from '@/features/cameraStage/application/cameraStageControlExecutors'
import { CameraStagePlacementOperationExecutor } from '@/features/cameraStage/application/cameraStagePlacementExecutor'
import { createCanvasReflectionRegistrations } from '@/features/canvas/application/canvasReflection'
import { CanvasNodeMutationExecutor } from '@/features/canvas/application/canvasMutationExecutor'
import { createAssetReflectionRegistrations } from '@/features/assets/application/assetReflection'
import { createImageEditReflectionRegistrations } from '@/features/imageEdit/application/imageEditReflection'
import { createStoryboardReflectionRegistrations } from '@/features/canvas/application/storyboardReflection'
import { createToolboxReflectionRegistration } from '@/features/toolbox/application/toolboxReflection'
import { createGenerationReflectionRegistrations } from '@/features/generation/application/generationReflection'
import { createAssistantRuntimeReflectionRegistrations } from '@/features/assistant/application/assistantRuntimeReflection'

let registry: ApplicationReflectionRegistry | undefined
let executionEngine: ApplicationControlExecutionEngine | undefined
let cameraStageDependencies: CameraStageControlExecutorDependencies = {
  readRevision: () => 0,
  bumpRevision: () => undefined,
}

export function configureCameraStageControlDependencies(
  dependencies: CameraStageControlExecutorDependencies,
): void {
  cameraStageDependencies = dependencies
}

/**
 * 反射注册表的构建。
 *
 * 两个刻意的写法，都是被实测坑出来的：
 *
 * 1. **先建到局部变量，全部注册成功才赋给模块单例。** 之前是先给 `registry` 赋值再逐条注册，
 *    于是任何一条注册失败都会留下一个"建了一半"的注册表，而后续每次调用因为 `registry`
 *    已经有值就直接返回它——第一次报一个错，之后全程静默地用残缺注册表跑。用户看到的是
 *    "有时候能用有时候不能"，日志里只有孤零零一条异常。
 * 2. **每条注册都带上来源标签重抛。** 底层抛的是 zod 的 ValidationError，只说"某个 id 不合
 *    规范"，既不说是哪个领域也不说实际值。实测那次就是这样：只知道有个 id 不匹配
 *    `^[a-z][a-z0-9_.-]{1,127}$`，完全无法定位。
 */
function registerAll(
  target: ApplicationReflectionRegistry,
  label: string,
  registrations: Parameters<ApplicationReflectionRegistry['register']>[0][]
): void {
  for (const registration of registrations) {
    try {
      target.register(registration)
    } catch (error) {
      const entityId = registration.entity?.id ?? '(未知实体)'
      throw new Error(
        `应用反射注册失败：${label} / ${entityId}。${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

export function getApplicationReflectionRegistry(): ApplicationReflectionRegistry {
  if (registry) return registry
  const next = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
  registerAll(next, 'settings', [createSettingsReflectionRegistration()])
  registerAll(next, 'assets', createAssetReflectionRegistrations())
  registerAll(next, 'canvas', createCanvasReflectionRegistrations())
  registerAll(next, 'storyboard', createStoryboardReflectionRegistrations())
  registerAll(next, 'image_edit', createImageEditReflectionRegistrations())
  registerAll(next, 'toolbox', [createToolboxReflectionRegistration()])
  registerAll(next, 'generation', createGenerationReflectionRegistrations())
  registerAll(next, 'assistant_runtime', createAssistantRuntimeReflectionRegistrations())
  registerAll(next, 'camera_stage', createCameraStageReflectionRegistrations(
    () => cameraStageDependencies.readRevision()
  ))
  registry = next
  return registry
}

export function getApplicationControlExecutionEngine(): ApplicationControlExecutionEngine {
  if (!executionEngine) {
    executionEngine = new ApplicationControlExecutionEngine(getApplicationReflectionRegistry())
    executionEngine.registerMutationExecutor(new SettingsMutationExecutor())
    executionEngine.registerMutationExecutor(new CanvasNodeMutationExecutor())
    const dependencies: CameraStageControlExecutorDependencies = {
      readRevision: () => cameraStageDependencies.readRevision(),
      bumpRevision: () => cameraStageDependencies.bumpRevision(),
    }
    for (const entityType of CAMERA_STAGE_MUTATION_ENTITY_TYPES) {
      executionEngine.registerMutationExecutor(new CameraStageMutationExecutor(entityType, dependencies))
    }
    executionEngine.registerOperationExecutor(new CameraStageMotionOperationExecutor(dependencies))
    executionEngine.registerOperationExecutor(new CameraStagePlacementOperationExecutor(dependencies))
  }
  return executionEngine
}
