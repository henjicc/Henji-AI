import { beforeEach, expect, it, vi } from 'vitest'

const { runCanvasNode, reportCanvasOperationFailure } = vi.hoisted(() => ({ runCanvasNode: vi.fn(), reportCanvasOperationFailure: vi.fn() }))
vi.mock('@/features/canvas/application/canvasExecutionService', () => ({ runCanvasNode }))
vi.mock('@/features/canvas/application/canvasOperationFeedback', () => ({ reportCanvasOperationFailure }))

import { GenerationPreparationError } from '@/features/generation/application/generationPreparationService'
import { runCanvasNodeFromUser } from './runCanvasNodeFromUser'

beforeEach(() => { vi.clearAllMocks() })

it('提交前被拒时用画布提示条说明原因，其他失败交给节点自身呈现', async () => {
  const rejection = new GenerationPreparationError('INVALID_INPUT', '模型 不接受当前素材：图片太小。')
  runCanvasNode.mockRejectedValueOnce(rejection)
  runCanvasNodeFromUser('node-1')
  await vi.waitFor(() => expect(reportCanvasOperationFailure).toHaveBeenCalledWith(rejection))

  runCanvasNode.mockRejectedValueOnce(new Error('供应商失败'))
  runCanvasNodeFromUser('node-2')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(reportCanvasOperationFailure).toHaveBeenCalledTimes(1)
})
