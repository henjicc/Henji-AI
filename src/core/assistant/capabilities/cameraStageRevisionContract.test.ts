import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITIES } from '../builtinApplicationCapabilityRegistry'

/**
 * 三维写入靠 `baseRevision` 做乐观并发。要让模型能连续写入而不是每写一次就重读一次工程，
 * **每个写能力都必须收 `baseRevision`，也必须回带写入后的 `baseRevision`**。
 *
 * 实测踩过的坑：摆放走事务引擎，只返回 `resultingRevisions` 这个映射，而复制、删除走的是
 * 另一条路，返回扁平的 `baseRevision`——同一个领域同一个概念两种形状。模型每摆一个物体都
 * 要额外读一次工程，叠加单轮工具位轮换，任务直接卡死。
 */
const cameraStageWrites = BUILTIN_APPLICATION_CAPABILITIES.filter((capability) => (
  capability.domain === 'camera_stage' && !capability.readOnly
))
const renderTaskWriteIds = new Set([
  'render_camera_stage_output',
  'cancel_camera_stage_render_task',
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

  // 新建与打开工程不存在"读取之后被改动"的问题，天然没有基线可比。
  const revisionScoped = cameraStageSceneWrites.filter((capability) => (
    schemaKeys(capability.inputSchema).includes('baseRevision')
  ))

  it('除新建与打开外的写能力都收 baseRevision', () => {
    const withoutBaseRevision = cameraStageSceneWrites
      .filter((capability) => !revisionScoped.includes(capability))
      .map((capability) => capability.id)
      .sort()
    expect(withoutBaseRevision).toEqual(['create_camera_stage_project', 'open_camera_stage_project'])
  })

  it('每个写能力都回带 baseRevision，形状与读能力一致', () => {
    const missing = cameraStageSceneWrites
      .filter((capability) => !schemaKeys(capability.outputSchema).includes('baseRevision'))
      .map((capability) => capability.id)
    expect(missing).toEqual([])
  })

  it('收 baseRevision 的写能力都写明了 CONFLICT 该怎么恢复', () => {
    const missing = revisionScoped
      .filter((capability) => !capability.failureRecovery.some((item) => item.includes('CONFLICT')))
      .map((capability) => capability.id)
    expect(missing).toEqual([])
  })

  it('后台渲染任务以画布目标和稳定 taskRef 防串，不伪装成场景 revision 写入', () => {
    expect(cameraStageRenderTaskWrites.map((capability) => capability.id).sort()).toEqual([
      'cancel_camera_stage_render_task',
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
      projectRef: { kind: 'canvas.project', id: 'canvas-1' },
      nodeRef: { kind: 'canvas.node', id: 'canvas-1:camera-node-1' },
      outputKind: 'image',
      resolutionPreset: '720p',
      selectedTimeSec: 0,
    })
    expect(render?.resolveTargetIds?.(renderInput)).toEqual({
      projectId: 'canvas-1', nodeRefId: 'canvas-1:camera-node-1',
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
