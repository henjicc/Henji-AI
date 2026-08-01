import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'
import { cameraStageControl, cameraStageTarget, cameraStageTransactionResultShape } from './cameraStageCapabilitySchemas'

const listProjects = defineApplicationCapability({
  id: 'list_camera_stage_projects', version: 2, title: '列出 3D 运镜工程',
  description: '列出 3D 运镜工程摘要和当前可观察 revision。', domain: 'camera_stage',
  aliases: ['3D 工程', '运镜工程', 'camera stage projects'], readOnly: true, risk: 'R0', dataClasses: ['C1'],
  permission: 'camera_stage:read', idempotent: true, destructive: false, timeoutMs: 8_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['toolbox'], producesRefs: ['camera_stage.project'],
  inputSchema: z.object({}).strict(),
  outputSchema: capabilityOutputSchema({ projects: z.array(z.record(z.string(), z.unknown())), baseRevision: z.number().int().nonnegative() }),
  concurrencyKey: 'camera_stage_catalog',
  control: cameraStageControl('observe', ['camera_stage.project']),
  summarize: (output) => `3D 运镜工程目录返回 ${output.projects.length} 项。`,
})

const getProject = defineApplicationCapability({
  id: 'get_camera_stage_project', version: 2, title: '读取 3D 运镜工程',
  description: '按工程引用读取结构化场景摘要、稳定子实体引用和 revision。', domain: 'camera_stage',
  aliases: ['3D 工程详情', 'get camera stage project'], readOnly: true, risk: 'R0', dataClasses: ['C1'],
  permission: 'camera_stage:read', idempotent: true, destructive: false, timeoutMs: 8_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project'],
  producesRefs: ['camera_stage.project', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({ project: z.record(z.string(), z.unknown()), baseRevision: z.number().int().nonnegative() }),
  concurrencyKey: 'camera_stage_project', resolveConcurrencyKey: (input) => `camera_stage_project:${input.projectId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  control: cameraStageControl('observe', ['camera_stage.project', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe']),
  summarize: (output) => `已读取 3D 运镜工程 ${String(output.project.id ?? '')}。`,
})

const openProject = defineApplicationCapability({
  id: 'open_camera_stage_project', version: 3, title: '打开 3D 运镜工程',
  description: '载入明确工程并立即打开 3D 镜头编辑器，供用户查看后续执行。', domain: 'camera_stage',
  aliases: ['进入 3D 工程', 'open camera stage project'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:open', idempotent: true, destructive: false, timeoutMs: 15_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['navigation', 'toolbox'],
  acceptsRefs: ['camera_stage.project'], producesRefs: ['camera_stage.project', 'application.surface'],
  successEvidence: ['工程已载入，返回 surfaceId=tool.camera_stage，且宿主当前 Surface 已验证为 3D 镜头编辑器。'],
  failureRecovery: ['工程或 Surface 不可用时停止，不得继续在其他工程写入。'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string(), name: z.string(), objectCount: z.number(), shotCount: z.number(), surfaceId: z.literal('tool.camera_stage'), baseRevision: z.number().int().nonnegative() }),
  concurrencyKey: 'camera_stage_open', resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  control: cameraStageControl('navigate', ['camera_stage.project'], [], ['navigation', 'toolbox']),
  summarize: (output) => `已打开 3D 运镜工程 ${output.projectId}。`,
})

const createProject = defineApplicationCapability({
  id: 'create_camera_stage_project', version: 3, title: '新建 3D 运镜工程',
  description: '创建带默认摄像机和初始镜头的 3D 运镜工程，但不切换当前界面。', domain: 'camera_stage',
  aliases: ['创建 3D 工程', 'new camera stage project'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:write', idempotent: false, destructive: false, timeoutMs: 15_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['toolbox'], producesRefs: ['camera_stage.project', 'camera_stage.camera', 'camera_stage.shot'],
  inputSchema: z.object({ name: z.string().trim().min(1).max(120), mode: z.enum(['simple', 'pro']).default('simple') }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string(), name: z.string(), mode: z.enum(['simple', 'pro']), defaultCameraId: z.string(), defaultShotId: z.string(), baseRevision: z.number().int().nonnegative() }),
  concurrencyKey: 'camera_stage_project', resolveTargetIds: (input) => ({ name: input.name }),
  control: cameraStageControl('create', ['camera_stage.project', 'camera_stage.camera', 'camera_stage.shot']),
  summarize: (output) => `已创建 3D 运镜工程 ${output.projectId}。`,
})

const renameProjectCapability = defineApplicationCapability({
  id: 'rename_camera_stage_project', version: 2, title: '重命名 3D 运镜工程', description: '重命名明确的 3D 运镜工程。',
  domain: 'camera_stage', aliases: ['修改 3D 工程名称', 'rename camera project'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:write', idempotent: true, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project'], producesRefs: ['camera_stage.project'],
  inputSchema: z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120), baseRevision: z.number().int().nonnegative() }).strict(),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage_project:${input.projectId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  control: cameraStageControl('update', ['camera_stage.project'], ['camera_stage.project.name']),
  summarize: (output) => `3D 工程重命名事务 ${output.transactionRef} 已完成。`,
})

const deleteProjectCapability = defineApplicationCapability({
  id: 'delete_camera_stage_project', version: 2, title: '删除 3D 运镜工程', description: '永久删除明确的 3D 运镜工程及其场景数据。',
  domain: 'camera_stage', aliases: ['永久删除 3D 工程', 'delete camera project'], readOnly: false, risk: 'R3', dataClasses: ['C1'],
  permission: 'camera_stage:delete', idempotent: true, destructive: true, timeoutMs: 15_000, supportsPreview: true, supportsUndo: false,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project'],
  inputSchema: z.object({ projectId: z.string().min(1), baseRevision: z.number().int().nonnegative() }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string(), status: z.literal('deleted'), baseRevision: z.number().int().nonnegative() }),
  resolveConcurrencyKey: (input) => `camera_stage_project:${input.projectId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  preview: (input) => ({ title: '删除 3D 运镜工程', summary: `永久删除工程 ${input.projectId}；此操作不可撤销。`, targetIds: cameraStageTarget(input.projectId), reversible: false, dataClasses: ['C1'] }),
  control: cameraStageControl('delete', ['camera_stage.project', 'camera_stage.scene']),
  summarize: (output) => `3D 运镜工程 ${output.projectId} 已删除。`,
})

export const CAMERA_STAGE_PROJECT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  listProjects, getProject, openProject, createProject, renameProjectCapability, deleteProjectCapability,
]
