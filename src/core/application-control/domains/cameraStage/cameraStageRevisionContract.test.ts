import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITIES } from '../../builtinApplicationCapabilityRegistry'

/** 三维写入使用统一可信信封，公开业务参数不再承担并发控制。 */
const cameraStageWrites = BUILTIN_APPLICATION_CAPABILITIES.filter((capability) => (
  capability.domain === 'camera_stage' && !capability.readOnly
))
const renderTaskWriteIds = new Set([
  'render_camera_stage_output',
  'cancel_camera_stage_render_task',
  'recover_camera_stage_render_task',
])
const cameraStageSceneWrites = cameraStageWrites.filter(
  (capability) => !renderTaskWriteIds.has(capability.id)
)
const cameraStageRenderTaskWrites = cameraStageWrites.filter(
  (capability) => renderTaskWriteIds.has(capability.id)
)

function schemaKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape
    ?? (schema as { _def?: { shape?: Record<string, unknown> } } | undefined)?._def?.shape
  return shape ? Object.keys(shape) : []
}

describe('三维写入的 revision 契约', () => {
  it('存在需要检查的写能力', () => {
    expect(cameraStageWrites.length).toBeGreaterThan(4)
  })

  // 新建与打开文档已归通用文档能力（3.2），三维写能力全部是对已有场景的修改。
  const revisionScoped = cameraStageSceneWrites.filter((capability) => (
    capability.requiredScopes.includes('camera_stage')
  ))

  it('全部场景写能力使用信封且不接受 baseRevision', () => {
    const withoutBaseRevision = cameraStageSceneWrites
      .filter((capability) => !revisionScoped.includes(capability) || schemaKeys(capability.inputSchema).includes('baseRevision'))
      .map((capability) => capability.id)
      .sort()
    expect(withoutBaseRevision).toEqual([])
  })

  it('全部场景写能力仅使用统一修订信封，不回带 baseRevision', () => {
    const missing = cameraStageSceneWrites
      .filter((capability) => schemaKeys(capability.outputSchema).includes('baseRevision'))
      .map((capability) => capability.id)
    expect(missing).toEqual([])
  })

  it('并发冲突明确指向正式实体读取', () => {
    const missing = revisionScoped
      .filter((capability) => !capability.failureRecovery.some((item) => item.includes('read_application_entity') && item.includes('baselineId')))
      .map((capability) => capability.id)
    expect(missing).toEqual([])
  })

  it('后台渲染任务以画布目标和稳定 taskRef 防串，不伪装成场景 revision 写入', () => {
    expect(cameraStageRenderTaskWrites.map((capability) => capability.id).sort()).toEqual([
      'cancel_camera_stage_render_task',
      'recover_camera_stage_render_task',
      'render_camera_stage_output',
    ])
    expect(cameraStageRenderTaskWrites.every((capability) => (
      !schemaKeys(capability.inputSchema).includes('baseRevision')
      && !schemaKeys(capability.outputSchema).includes('baseRevision')
      && capability.producesRefs.includes('camera_stage.render_task')
    ))).toBe(true)

    const render = cameraStageRenderTaskWrites.find(
      (capability) => capability.id === 'render_camera_stage_output'
    )
    const renderInput = render?.inputSchema.parse({
      canvasRef: { kind: 'canvas.document', id: 'canvas-1' },
      nodeRef: { kind: 'canvas.node', id: 'canvas-1:camera-node-1' },
      outputKind: 'image',
      resolutionPreset: '720p',
      selectedTimeSec: 0,
    })
    expect(render?.resolveTargetIds?.(renderInput)).toEqual({
      canvasDocumentId: 'canvas-1', nodeRefId: 'canvas-1:camera-node-1',
    })
    expect(render?.outputSchema.parse({
      revision: 0,
      scopeRevisions: {},
      taskRef: { kind: 'camera_stage.render_task', id: 'task-1' },
      status: 'submitted',
      resultRefs: [{ kind: 'camera_stage.render_task', id: 'task-1' }],
    })).toMatchObject({ status: 'submitted' })

    const cancel = cameraStageRenderTaskWrites.find(
      (capability) => capability.id === 'cancel_camera_stage_render_task'
    )
    const cancelInput = cancel?.inputSchema.parse({
      taskRef: { kind: 'camera_stage.render_task', id: 'task-1' },
    })
    expect(cancel?.resolveTargetIds?.(cancelInput)).toEqual({ taskRefId: 'task-1' })
    expect(cancel?.outputSchema.parse({
      revision: 0,
      scopeRevisions: {},
      taskRef: { kind: 'camera_stage.render_task', id: 'task-1' },
      status: 'cancellation_requested',
      resultRefs: [],
    })).toMatchObject({ status: 'cancellation_requested' })
  })

  it('旧程序配方不再作为第二套应用能力注册', () => {
    expect(BUILTIN_APPLICATION_CAPABILITIES.map((capability) => capability.id)).not.toEqual(
      expect.arrayContaining(['execute_application_program', 'run_camera_stage_state_animation_program']),
    )
  })
})
