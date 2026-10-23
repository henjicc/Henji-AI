import {
  APPLICATION_CONTROL_COVERAGE_VERSION,
  applicationControlCoverageManifestSchema,
  type ApplicationCapabilityMigration,
  type ApplicationControlCoverageManifest,
  type ApplicationPublicControlCoverage,
  type ApplicationSurfaceObservationCoverage,
} from '.'
import { APPLICATION_SURFACE_IDS, resolveSurfaceObservationProfile } from './applicationSurfaces'
import {
  APPLICATION_CAPABILITY_CATALOG_VERSION,
  type ApplicationCapabilityDefinition,
} from './applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITIES, BUILTIN_APPLICATION_DOMAIN_METADATA } from './builtinApplicationCapabilityRegistry'

type PublicControlInputs = Readonly<{
  settings: readonly string[]
  surfaces: readonly string[]
  models: readonly string[]
  imageEditTools: readonly string[]
  cameraStageProperties: readonly string[]
  canvasNodes: readonly string[]
  /** 来自正式反射注册结果；不能在覆盖清单重写实体名单。 */
  entities: readonly { id: string; domain: string }[]
}>

function capabilityMigration(
  capability: ApplicationCapabilityDefinition
): ApplicationCapabilityMigration {
  const plan = BUILTIN_APPLICATION_DOMAIN_METADATA[capability.domain]
  if (!plan) throw new Error(`应用控制覆盖缺少领域计划：${capability.domain}`)
  return {
    capabilityId: capability.id,
    domain: capability.domain,
    source: plan.operationSource,
    disposition: 'retain',
    targetIds: [capability.id],
    targetKind: plan.targetKind,
    migrationTask: plan.migrationTask,
    deleteWhen: '当前 ID 已是原生 ApplicationCapabilityDefinition，正式领域服务为唯一业务实现；旧 HostCommand/HostQuery 执行入口已删除。',
    verification: [...capability.successEvidence],
  }
}

function surfaceObservation(surfaceId: string): ApplicationSurfaceObservationCoverage {
  // 提供者、敏感度和模态全部来自 resolveSurfaceObservationProfile，
  // 与运行时 surfaceCatalog 共用同一份判断，避免清单和实际捕获策略各说各话。
  const profile = resolveSurfaceObservationProfile(surfaceId)
  return {
    surfaceId,
    providerId: profile.providerId,
    implementationStatus: 'available',
    resultModalities: [...profile.modalities],
    dataClass: profile.dataClass,
    captureScope: profile.strategy === 'native_media_preferred'
      ? `优先返回 ${surfaceId} 的稳定媒体原件，回退时仅限该 Surface 注册区域。`
      : `仅限 Henji-AI 应用窗口内注册的 ${surfaceId} 区域。`,
    maskPolicyId: profile.maskPolicyId,
    verification: '提供者返回与请求 Surface ID 一致的稳定观察结果，并记录实际遮罩。',
    migrationTask: '6.5',
  }
}

const publicSource = {
  setting: ['src/features/settings/application-control/', 'settings.registry', '5.1'],
  surface: ['src/features/navigation/application/surfaceCatalog.ts', 'application.surface', '5.1'],
  model: ['packages/ai-sdk/src/catalog/**.model.ts + src/models/presentation/**.presentation.ts', 'generation.model', '5.4'],
  image_edit_tool: ['src/features/imageEdit/tools/registry.ts', 'image_edit.document', '5.3'],
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
      targetPropertyId: kind === 'setting' ? id : undefined,
      migrationTask,
      // 注册清点不等于执行验收；可调用性由外部覆盖门禁与结果测试独立核对。
      status: 'registered' as const,
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
    domains: Object.entries(BUILTIN_APPLICATION_DOMAIN_METADATA).map(([domain, metadata]) => ({
      domain, migrationTask: metadata.migrationTask, formalService: metadata.formalService,
      entityTypes: [...new Set([
        ...inputs.entities.filter(entity => entity.domain === domain).map(entity => entity.id),
        ...capabilities.filter(capability => capability.domain === domain)
          .flatMap(capability => capability.control.impacts.flatMap(impact => impact.entityTypes)),
      ])],
      propertySources: metadata.propertySources, operationSource: metadata.operationSource, querySource: metadata.operationSource,
      observationSource: 'observe_application_surface 受控观察提供者；结构化状态仍由正式服务读取',
      verificationSource: 'ApplicationCapabilityDefinition.successEvidence 与后续事务证据',
      surfaceIds: metadata.surfaceIds,
    })),
    capabilityMigrations: capabilities.map(capabilityMigration),
    surfaceObservations: APPLICATION_SURFACE_IDS.map(surfaceObservation),
    publicControls: publicControls(inputs),
  })
}
