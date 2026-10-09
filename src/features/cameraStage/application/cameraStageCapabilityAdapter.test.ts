import { expect, it, vi } from 'vitest'
import type { ApplicationControlExecutionEngine } from '@/core/application-control'

vi.mock('@/features/application-control/hostContext/hostContext', () => ({ getHostScopeRevisions: () => ({ toolbox: 4 }) }))

import { applyCameraStageCameraMove } from './cameraStageCapabilityAdapter'
import { CameraStageMotionOperationExecutor } from './cameraStageControlExecutors'

it('运镜能力委托上下文注入的事务引擎并保留并发基线与回读修订', async () => {
  const plan = vi.fn().mockResolvedValue({ planRef: 'plan-1' })
  const commit = vi.fn().mockResolvedValue({ status: 'completed', resultingRevisions: { toolbox: 4 } })
  const engine = { plan, commit } as unknown as ApplicationControlExecutionEngine
  const result = await applyCameraStageCameraMove({ baseRevision: 4, projectId: 'document-1' }, {
    signal: new AbortController().signal, requestId: 'request-1', getExecutionEngine: () => engine,
  })
  expect(plan.mock.calls[0][0].steps).toEqual([{
    kind: 'operation', capabilityId: 'apply_camera_stage_camera_move', capabilityVersion: 1,
    input: { projectId: 'document-1' }, expectedRevisions: { toolbox: 4 },
  }])
  expect(commit.mock.calls[0][0]).toMatchObject({ planRef: 'plan-1', expectedRevisions: { toolbox: 4 } })
  expect(result).toMatchObject({ status: 'completed', baseRevision: 4 })
})

it.each([
  [{ kind: 'orbit', degrees: 1, direction: 'cw' }, true],
  [{ kind: 'orbit', degrees: 1441, direction: 'cw' }, false],
  [{ kind: 'dollyIn', distanceRatio: 0.05 }, true],
  [{ kind: 'dollyOut', distanceRatio: 20.01 }, false],
  [{ kind: 'truck', offset: -10000 }, true],
  [{ kind: 'crane', height: 10001 }, false],
  [{ kind: 'orbit', degrees: 90, direction: 'cw', unexpected: true }, false],
])('执行器遵守公开运镜范围与封闭字段：%j', (move, accepted) => {
  const executor = new CameraStageMotionOperationExecutor({ readRevision: () => 0, bumpRevision: () => undefined })
  const normalize = () => executor.normalizeInput({ projectId: 'document-1', cameraId: 'camera-1', move, duration: 1, speed: 'uniform' })
  if (accepted) expect(normalize).not.toThrow()
  else expect(normalize).toThrow()
})
