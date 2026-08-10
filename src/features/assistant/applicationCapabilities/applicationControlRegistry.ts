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
import { CameraStageKeyframeCollectionExecutor } from '@/features/cameraStage/application/cameraStageKeyframeCollectionExecutor'
import { CameraStageShotCollectionExecutor } from '@/features/cameraStage/application/cameraStageShotCollectionExecutor'
import { createCanvasReflectionRegistrations, CANVAS_ENTITY_TYPES } from '@/features/canvas/application/canvasReflection'
import {
  CanvasCollectionExecutor,
  type CanvasCollectionDependencies,
} from '@/features/canvas/application/canvasCollectionExecutor'
import { CanvasNodeMutationExecutor } from '@/features/canvas/application/canvasMutationExecutor'
import { CanvasProjectMutationExecutor } from '@/features/canvas/application/canvasProjectMutationExecutor'
import {
  AssetMutationExecutor,
  type AssetMutationDependencies,
} from '@/features/assets/application/assetMutationExecutor'
import { createAssetReflectionRegistrations } from '@/features/assets/application/assetReflection'
import { AssetLibraryMutationExecutor } from '@/features/assets/application/assetLibraryMutationExecutor'
import { AssetLibraryCollectionExecutor } from '@/features/assets/application/assetLibraryCollectionExecutor'
import { createImageEditReflectionRegistrations } from '@/features/imageEdit/application/imageEditReflection'
import { createImageMarkReflectionRegistrations } from '@/features/imageMark/application/imageMarkReflection'
import { ImageMarkDocumentMutationExecutor } from '@/features/imageMark/application/imageMarkDocumentMutationExecutor'
import { ImageMarkAnnotationMutationExecutor } from '@/features/imageMark/application/imageMarkAnnotationMutationExecutor'
import { ImageMarkAnnotationCollectionExecutor } from '@/features/imageMark/application/imageMarkAnnotationCollectionExecutor'
import { createStoryboardReflectionRegistrations } from '@/features/canvas/application/storyboardReflection'
import { createToolboxReflectionRegistration } from '@/features/toolbox/application/toolboxReflection'
import {
  createGenerationDraftReflectionRegistration,
  createGenerationReflectionRegistrations,
} from '@/features/generation/application/generationReflection'
import { GenerationDraftMutationExecutor } from '@/features/generation/application/generationDraftMutationExecutor'
import { GenerationModelMutationExecutor } from '@/features/generation/application/generationModelMutationExecutor'
import { createAssistantRuntimeReflectionRegistrations } from '@/features/assistant/application/assistantRuntimeReflection'

let registry: ApplicationReflectionRegistry | undefined
let executionEngine: ApplicationControlExecutionEngine | undefined
let cameraStageDependencies: CameraStageControlExecutorDependencies = {
  readRevision: () => 0,
  bumpRevision: () => undefined,
}

let canvasCollectionDependencies: CanvasCollectionDependencies = {
  readRevision: () => 0,
  bumpRevision: () => undefined,
}

let assetMutationDependencies: AssetMutationDependencies = {
  readRevision: () => 0,
  bumpRevision: () => undefined,
}

export function configureAssetMutationDependencies(dependencies: AssetMutationDependencies): void {
  assetMutationDependencies = dependencies
}

export function configureCanvasCollectionDependencies(
  dependencies: CanvasCollectionDependencies,
): void {
  canvasCollectionDependencies = dependencies
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
  registerAll(next, 'image_mark', createImageMarkReflectionRegistrations())
  registerAll(next, 'toolbox', [createToolboxReflectionRegistration()])
  registerAll(next, 'generation', createGenerationReflectionRegistrations())
  registerAll(next, 'generation_draft', [createGenerationDraftReflectionRegistration()])
  registerAll(next, 'assistant_runtime', createAssistantRuntimeReflectionRegistrations())
  registerAll(next, 'camera_stage', createCameraStageReflectionRegistrations(
    () => cameraStageDependencies.readRevision()
  ))
  registry = next
  return registry
}

/** 与注册表同理：全部执行器注册成功才赋给模块单例，避免半成品被后续调用静默复用。 */
export function getApplicationControlExecutionEngine(): ApplicationControlExecutionEngine {
  if (executionEngine) return executionEngine
  const next = new ApplicationControlExecutionEngine(getApplicationReflectionRegistry())
  next.registerMutationExecutor(new SettingsMutationExecutor())
  next.registerMutationExecutor(new CanvasNodeMutationExecutor())
  next.registerMutationExecutor(new CanvasProjectMutationExecutor())
  // 生成模型：闭合 4.4 松绑 models.visibility 后新增的 generation.model.hidden 悬空可写声明。
  next.registerMutationExecutor(new GenerationModelMutationExecutor())
  // 生成草稿：5.4 注册 generation.draft 实体后闭合它的可写属性声明。
  next.registerMutationExecutor(new GenerationDraftMutationExecutor())
  // 标注文档与标注对象：6.2 闭合 image_mark.document/image_mark.annotation 的可写属性声明，
  // 标注的新建/删除走下面的集合执行器。
  next.registerMutationExecutor(new ImageMarkDocumentMutationExecutor())
  next.registerMutationExecutor(new ImageMarkAnnotationMutationExecutor())
  next.registerCollectionExecutor(new ImageMarkAnnotationCollectionExecutor())
  // 素材：闭合 asset.tags 与 asset.library_refs 的悬空可写声明
  next.registerMutationExecutor(new AssetMutationExecutor({
    readRevision: () => assetMutationDependencies.readRevision(),
    bumpRevision: () => assetMutationDependencies.bumpRevision(),
  }))
  next.registerMutationExecutor(new AssetLibraryMutationExecutor({
    readRevision: () => assetMutationDependencies.readRevision(),
    bumpRevision: () => assetMutationDependencies.bumpRevision(),
  }))
  next.registerCollectionExecutor(new AssetLibraryCollectionExecutor({
    readRevision: () => assetMutationDependencies.readRevision(),
    bumpRevision: () => assetMutationDependencies.bumpRevision(),
  }))
  const dependencies: CameraStageControlExecutorDependencies = {
    readRevision: () => cameraStageDependencies.readRevision(),
    bumpRevision: () => cameraStageDependencies.bumpRevision(),
  }
  for (const entityType of CAMERA_STAGE_MUTATION_ENTITY_TYPES) {
    next.registerMutationExecutor(new CameraStageMutationExecutor(entityType, dependencies))
  }
  next.registerOperationExecutor(new CameraStageMotionOperationExecutor(dependencies))
  next.registerOperationExecutor(new CameraStagePlacementOperationExecutor(dependencies))
  // 集合写入：关键帧从"只能读改"变成"可以创建"，助手据此就能表达任意对象动画，
  // 不再需要为上下漂浮、自转这类需求各写一个专用能力。
  next.registerCollectionExecutor(new CameraStageKeyframeCollectionExecutor(dependencies))
  // 镜头卡：删除/批量删除接到集合写入，同一次提交删掉功能重复的专用能力 add_camera_stage_shot。
  next.registerCollectionExecutor(new CameraStageShotCollectionExecutor(dependencies))
  // 画布节点与连线：写入全部委托 applyCanvasOperationsAtomically，与批量能力共用同一内核。
  // revision 依赖由适配器注入，注册表不直接 import hostContext——那条 import 会把 taskQueue
  // 一起拉进模块图，而它在初始化时读 localStorage，Node 环境的用例会直接崩。
  const canvasDependencies: CanvasCollectionDependencies = {
    readRevision: () => canvasCollectionDependencies.readRevision(),
    bumpRevision: () => canvasCollectionDependencies.bumpRevision(),
  }
  next.registerCollectionExecutor(new CanvasCollectionExecutor(CANVAS_ENTITY_TYPES.node, canvasDependencies))
  next.registerCollectionExecutor(new CanvasCollectionExecutor(CANVAS_ENTITY_TYPES.edge, canvasDependencies))
  executionEngine = next
  return executionEngine
}
