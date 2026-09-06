import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../builtinApplicationCapabilityRegistry'
import {
  CAMERA_STAGE_RENDER_CAPABILITY_ID,
  CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID,
  GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID,
} from './cameraStageRenderApplicationCapabilities'

describe('cameraStageRenderApplicationCapabilities', () => {
  it('registers strict render, query, and cancellation contracts with stable task refs', () => {
    const render = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(CAMERA_STAGE_RENDER_CAPABILITY_ID)
    const get = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID)
    const cancel = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID)

    expect(render).toMatchObject({ completionKind: 'submitted', risk: 'R1', requiredScopes: ['canvas'] })
    expect(render?.inputSchema.safeParse({
      projectRef: { kind: 'canvas.project', id: 'canvas-1' },
      nodeRef: { kind: 'canvas.node', id: 'canvas-1:stage-node' },
      outputKind: 'image',
    }).success).toBe(true)
    expect(render?.inputSchema.safeParse({
      projectRef: { kind: 'canvas.project', id: 'canvas-1' },
      nodeRef: { kind: 'canvas.node', id: 'canvas-1:stage-node' },
      outputKind: 'image',
      rawNodeId: 'stage-node',
    }).success).toBe(false)
    expect(render?.inputSchema.safeParse({
      projectRef: { kind: 'canvas.project', id: 'canvas-1' },
      nodeRef: { kind: 'canvas.node', id: 'canvas-1:stage-node' },
      outputKind: 'video',
      selectedTimeSec: 1,
    }).success).toBe(false)
    expect(render?.control.impacts.map((impact) => impact.effect)).toEqual(['execute', 'create'])
    expect(render?.producesRefs).toEqual(['camera_stage.render_task'])

    expect(get).toMatchObject({ readOnly: true, risk: 'R0', requiredScopes: [] })
    expect(get?.acceptsRefs).toEqual(['camera_stage.render_task'])
    expect(cancel).toMatchObject({ readOnly: false, risk: 'R2', supportsPreview: true })
    expect(cancel?.acceptsRefs).toEqual(['camera_stage.render_task'])
    const cancelInput = cancel?.inputSchema.parse({
      taskRef: { kind: 'camera_stage.render_task', id: 'internal-opaque-task-ref' },
    })
    if (!cancel || !cancelInput || !cancel.preview) throw new Error('取消能力缺少审批预览')
    expect(cancel.preview(cancelInput).summary).not.toContain('internal-opaque-task-ref')
  })
})
