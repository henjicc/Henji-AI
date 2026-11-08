import { beforeEach, expect, it, vi } from 'vitest'

const { runCanvasNode, showAlertDialog } = vi.hoisted(() => ({ runCanvasNode: vi.fn(), showAlertDialog: vi.fn() }))
vi.mock('@/features/canvas/application/canvasExecutionService', () => ({ runCanvasNode }))
vi.mock('@/stores/alertDialogStore', () => ({ showAlertDialog }))

import { GenerationPreparationError } from '@/features/generation/application/generationPreparationService'
import { runCanvasNodeFromUser } from './runCanvasNodeFromUser'

beforeEach(() => { vi.clearAllMocks() })

it('提交前被拒时把原因弹给用户，其他失败交给节点自身呈现', async () => {
  runCanvasNode.mockRejectedValueOnce(new GenerationPreparationError('INVALID_INPUT', '模型 不接受当前素材：图片太小。'))
  runCanvasNodeFromUser('node-1')
  await vi.waitFor(() => expect(showAlertDialog).toHaveBeenCalledWith(expect.objectContaining({ message: '模型 不接受当前素材：图片太小。', type: 'warning' })))

  runCanvasNode.mockRejectedValueOnce(new Error('供应商失败'))
  runCanvasNodeFromUser('node-2')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(showAlertDialog).toHaveBeenCalledTimes(1)
})
