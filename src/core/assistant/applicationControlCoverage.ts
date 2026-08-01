import {
  APPLICATION_CONTROL_COVERAGE_VERSION,
  applicationControlCoverageManifestSchema,
  type ApplicationCapabilityMigration,
  type ApplicationControlCoverageManifest,
  type ApplicationDomainCoverage,
  type ApplicationPublicControlCoverage,
  type ApplicationSurfaceObservationCoverage,
} from '../application-control'
import { APPLICATION_SURFACE_IDS } from './applicationSurfaces'
import {
  APPLICATION_CAPABILITY_CATALOG_VERSION,
  type ApplicationCapabilityDefinition,
} from './applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITIES } from './builtinApplicationCapabilityRegistry'

type PublicControlInputs = Readonly<{
  settings: readonly string[]
  surfaces: readonly string[]
  models: readonly string[]
  imageEditTools: readonly string[]
  cameraStageProperties: readonly string[]
  canvasNodes: readonly string[]
}>

interface DomainPlan extends ApplicationDomainCoverage {
  source: string
  readTargetId: string
  writeTargetIds: string[]
  targetKind: ApplicationCapabilityMigration['targetKind']
}

const domainPlans: Readonly<Record<string, DomainPlan>> = {
  application: domainPlan('application', '2.2', 'src/core/application-control/', ['application.context'], ['src/core/application-control/reflection.ts'], 'src/core/assistant/builtinApplicationCapabilities.ts', 'application.observe', ['application.observe'], 'query'),
  navigation: domainPlan('navigation', '5.1', 'src/stores/navigationStore.ts 与 src/stores/uiStore.ts', ['application.surface'], ['workspace.*', 'tool.*', 'settings.*', 'overlay.assets'], 'src/core/assistant/builtinApplicationCapabilities.ts 与 generationApplicationCapabilities.ts', 'surface.observe', ['surface.open', 'surface.close', 'surface.focus'], 'operation'),
  settings: domainPlan('settings', '5.1', 'src/features/assistant/applicationCapabilities/settingsRegistry.ts', ['settings.entry'], ['settingsRegistry.ts', 'settingsRegistryAdditional.ts'], 'src/core/assistant/builtinApplicationCapabilities.ts', 'application.observe', ['application.plan', 'application.commit'], 'property'),
  generation: domainPlan('generation', '5.4', 'src/core/services/GenerationService.ts', ['generation.task', 'generation.result'], ['src/models/**.model.ts'], 'generationApplicationCapabilities.ts 与 builtinApplicationCapabilities.ts', 'application.observe', ['generation.prepare', 'generation.submit', 'generation.cancel'], 'operation'),
  models: domainPlan('models', '5.4', 'src/core/ModelRegistry.ts', ['model.definition'], ['src/models/**.model.ts'], 'generationApplicationCapabilities.ts', 'application.describe', ['model.select'], 'query'),
  image_edit: domainPlan('image_edit', '5.3', 'src/core/imageEdit 与 src/features/imageEdit/application/', ['image_edit.document', 'image_edit.operation'], ['src/features/imageEdit/tools/registry.ts'], 'toolboxApplicationCapabilities.ts 与 builtinApplicationCapabilities.ts', 'application.observe', ['image_edit.preview', 'image_edit.commit'], 'operation'),
  assets: domainPlan('assets', '5.3', 'src/features/assets/store/assetLibraryStore.ts 待提取正式服务', ['asset', 'asset.library', 'asset.tag'], ['src/features/assets/'], 'assetApplicationCapabilities.ts', 'application.observe', ['asset.update', 'asset.delete'], 'operation'),
  canvas: domainPlan('canvas', '5.2', 'src/features/canvas/application/', ['canvas.project', 'canvas.node', 'canvas.edge'], ['src/features/canvas/domain/nodeRegistry.ts'], 'canvas*ApplicationCapabilities.ts', 'application.observe', ['application.plan', 'application.commit'], 'property'),
  camera_stage: domainPlan('camera_stage', '4.1', 'src/features/cameraStage/application/ 与 projects/cameraStageProjectService.ts', ['camera_stage.project', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe'], ['src/features/cameraStage/application/cameraStageReflection.ts', 'src/features/cameraStage/domain/animatableProps.ts'], 'cameraStage*ApplicationCapabilities.ts', 'observe_camera_stage_scene', ['application.plan', 'application.commit', 'place_camera_stage_object', 'apply_camera_stage_camera_move'], 'operation'),
  toolbox: domainPlan('toolbox', '5.3', 'src/stores/navigationStore.ts 与工具注册表', ['toolbox.tool'], ['src/features/imageEdit/tools/registry.ts'], 'toolboxApplicationCapabilities.ts', 'application.observe', ['toolbox.select'], 'operation'),
  storyboard: domainPlan('storyboard', '5.3', 'src/features/storyboard/ 与画布分镜应用层', ['storyboard.project', 'storyboard.frame'], ['src/features/canvas/domain/nodeRegistry.ts'], 'toolboxApplicationCapabilities.ts', 'application.observe', ['storyboard.update'], 'operation'),
  workflows: domainPlan('workflows', '5.4', 'electron/main/services/agent-runtime/workflows/', ['workflow.definition', 'workflow.run'], ['electron/main/services/agent-runtime/workflows/'], 'workflowApplicationCapabilities.ts', 'application.observe', ['workflow.plan', 'workflow.execute'], 'operation'),
  artifacts: runtimeDomainPlan('artifacts', 'read_agent_artifact'),
  diagnostics: runtimeDomainPlan('diagnostics', 'query_diagnostic_events'),
  memory: runtimeDomainPlan('memory', 'list_agent_memories'),
  user_instructions: runtimeDomainPlan('user_instructions', 'get_user_instructions'),
  catalog: runtimeDomainPlan('catalog', 'discover_application_capabilities'),
}

const mergeTargets: Readonly<Record<string, readonly string[]>> = {
  get_current_application_context: ['application.observe'],
  search_application_settings: ['application.describe'],
  get_application_settings: ['application.observe'],
  plan_application_settings_change: ['application.plan'],
  apply_application_settings_change: ['application.commit'],
  plan_canvas_batch: ['application.plan'],
  preview_canvas_batch: ['application.plan'],
  commit_canvas_batch: ['application.commit'],
  update_camera_stage_object: ['application.plan', 'application.commit'],
}

const deleteTargets: Readonly<Record<string, readonly string[]>> = {
  update_canvas_node: ['application.plan', 'application.commit'],
}

const retainedDomains = new Set(['artifacts', 'diagnostics', 'memory', 'user_instructions', 'catalog'])

function domainPlan(
  domain: string,
  migrationTask: string,
  formalService: string,
  entityTypes: string[],
  propertySources: string[],
  operationSource: string,
  readTargetId: string,
  writeTargetIds: string[],
  targetKind: ApplicationCapabilityMigration['targetKind']
): DomainPlan {
  return {
    domain,
    migrationTask,
    formalService,
    entityTypes,
    propertySources,
    operationSource,
    querySource: operationSource,
    observationSource: domain === 'camera_stage'
      ? 'camera_stage.viewport_observer 与 observe_camera_stage_scene；其他 Surface 在任务 6.5 推广'
      : '任务 6.5 的受控观察提供者；结构化状态由正式服务读取',
    verificationSource: 'ApplicationCapabilityDefinition.successEvidence 与后续事务证据',
    surfaceIds: surfacesForDomain(domain),
    source: operationSource,
    readTargetId,
    writeTargetIds,
    targetKind,
  }
}

function runtimeDomainPlan(domain: string, targetId: string): DomainPlan {
  return domainPlan(
    domain,
    '7.1',
    'electron/main/services/agent-runtime/',
    [`assistant.${domain}`],
    ['src/core/assistant/'],
    'assistantRuntimeApplicationCapabilities.ts',
    targetId,
    [targetId],
    'runtime'
  )
}

function surfacesForDomain(domain: string): string[] {
  const mappings: Readonly<Record<string, string[]>> = {
    navigation: [...APPLICATION_SURFACE_IDS],
    settings: APPLICATION_SURFACE_IDS.filter((id) => id.startsWith('settings.')),
    generation: ['workspace.generation'],
    models: ['workspace.generation', 'settings.models'],
    image_edit: ['tool.image_edit'],
    assets: ['workspace.assets', 'overlay.assets'],
    canvas: ['workspace.canvas'],
    camera_stage: ['tool.camera_stage'],
    toolbox: ['workspace.tools'],
  }
  return mappings[domain] ?? []
}

function capabilityMigration(
  capability: ApplicationCapabilityDefinition
): ApplicationCapabilityMigration {
  const plan = domainPlans[capability.domain]
  if (!plan) throw new Error(`应用控制覆盖缺少领域计划：${capability.domain}`)
  const retained = retainedDomains.has(capability.domain)
  const merge = mergeTargets[capability.id]
  const remove = deleteTargets[capability.id]
  const disposition = retained ? 'retain' : remove ? 'delete' : merge ? 'merge' : 'migrate'
  const targetIds = retained
    ? [capability.id]
    : [...(remove ?? merge ?? (capability.readOnly ? [plan.readTargetId] : plan.writeTargetIds))]
  return {
    capabilityId: capability.id,
    domain: capability.domain,
    source: plan.source,
    disposition,
    targetIds,
    targetKind: retained ? 'runtime' : plan.targetKind,
    migrationTask: plan.migrationTask,
    deleteWhen: retained
      ? '运行时基础能力保持唯一实现；7.1 仅复核元数据与门禁。'
      : `任务 ${plan.migrationTask} 完成正式服务、目标入口和回归验证后删除旧能力 ID。`,
    verification: [...capability.successEvidence],
  }
}

function surfaceProvider(surfaceId: string): string {
  if (surfaceId === 'tool.camera_stage') return 'camera_stage.viewport_observer'
  if (surfaceId === 'tool.image_edit') return 'image_edit.canvas_observer'
  if (surfaceId === 'workspace.canvas') return 'canvas.viewport_observer'
  if (surfaceId === 'workspace.generation') return 'generation.result_observer'
  if (surfaceId === 'workspace.assets' || surfaceId === 'overlay.assets') return 'assets.media_observer'
  return 'surface.region_observer'
}

function surfaceObservation(surfaceId: string): ApplicationSurfaceObservationCoverage {
  const sensitive = surfaceId === 'settings.api_keys' || surfaceId === 'settings.storage'
  return {
    surfaceId,
    providerId: surfaceProvider(surfaceId),
    implementationStatus: surfaceId === 'tool.camera_stage' ? 'available' : 'planned',
    resultModalities: surfaceId === 'workspace.generation'
      ? ['image', 'video', 'audio']
      : ['image'],
    dataClass: sensitive ? 'C2' : 'C1',
    captureScope: `仅限 Henji-AI 应用窗口内注册的 ${surfaceId} 区域。`,
    maskPolicyId: sensitive ? 'surface.mask_sensitive_fields' : 'surface.mask_declared_fields',
    verification: '提供者返回与请求 Surface ID 一致的稳定观察结果，并记录实际遮罩。',
    migrationTask: surfaceId === 'tool.camera_stage' ? '4.4' : '6.5',
  }
}

const publicSource = {
  setting: ['src/features/assistant/applicationCapabilities/settingsRegistry.ts', 'settings.entry', '5.1'],
  surface: ['src/features/assistant/applicationCapabilities/surfaceRegistry.ts', 'application.surface', '5.1'],
  model: ['src/models/**.model.ts', 'model.definition', '5.4'],
  image_edit_tool: ['src/features/imageEdit/tools/registry.ts', 'image_edit.operation', '5.3'],
  camera_stage_property: ['src/features/cameraStage/domain/animatableProps.ts', 'camera_stage.object', '4.1'],
  canvas_node: ['src/features/canvas/domain/nodeRegistry.ts', 'canvas.node', '5.2'],
} as const

function publicControls(input: PublicControlInputs): ApplicationPublicControlCoverage[] {
  const groups = [
    ['setting', input.settings],
    ['surface', input.surfaces],
    ['model', input.models],
    ['image_edit_tool', input.imageEditTools],
    ['camera_stage_property', input.cameraStageProperties],
    ['canvas_node', input.canvasNodes],
  ] as const
  return groups.flatMap(([kind, ids]) => {
    const [source, targetEntityType, migrationTask] = publicSource[kind]
    return ids.map((id) => ({
      kind,
      id,
      source,
      targetEntityType,
      targetPropertyId: kind === 'setting' ? `settings.${id}` : undefined,
      migrationTask,
      status: 'covered' as const,
    }))
  })
}

export function createApplicationControlCoverageManifest(
  inputs: PublicControlInputs,
  capabilities: readonly ApplicationCapabilityDefinition[] = BUILTIN_APPLICATION_CAPABILITIES
): ApplicationControlCoverageManifest {
  return applicationControlCoverageManifestSchema.parse({
    version: APPLICATION_CONTROL_COVERAGE_VERSION,
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    domains: Object.values(domainPlans).map(({ source: _source, readTargetId: _readTargetId, writeTargetIds: _writeTargetIds, targetKind: _targetKind, ...plan }) => plan),
    capabilityMigrations: capabilities.map(capabilityMigration),
    surfaceObservations: APPLICATION_SURFACE_IDS.map(surfaceObservation),
    publicControls: publicControls(inputs),
  })
}
