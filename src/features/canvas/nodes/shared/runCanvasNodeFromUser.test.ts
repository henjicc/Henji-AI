import { beforeEach, expect, it, vi } from 'vitest'

const { runCanvasNode, reportCanvasOperationFailure, isCanvasNodeBodyVisible } = vi.hoisted(() => ({
  runCanvasNode: vi.fn(), reportCanvasOperationFailure: vi.fn(), isCanvasNodeBodyVisible: vi.fn(),
}))
vi.mock('@/features/canvas/application/canvasExecutionService', () => ({ runCanvasNode }))
vi.mock('@/features/canvas/application/canvasOperationFeedback', () => ({ reportCanvasOperationFailure }))
vi.mock('@/features/canvas/presence/useCanvasNodePresence', () => ({ isCanvasNodeBodyVisible }))

import { GenerationPreparationError } from '@/features/generation/application/generationPreparationService'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { runCanvasNodeFromUser } from './runCanvasNodeFromUser'

beforeEach(() => {
  vi.clearAllMocks()
  isCanvasNodeBodyVisible.mockReturnValue(true)
  useAlertDialogStore.setState({ queue: [] })
})

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

it('提交前被拒时用画布提示条说明原因，其他失败交给节点自身呈现', async () => {
  const rejection = new GenerationPreparationError('INVALID_INPUT', '模型 不接受当前素材：图片太小。')
  runCanvasNode.mockRejectedValueOnce(rejection)
  runCanvasNodeFromUser('node-1')
  await vi.waitFor(() => expect(reportCanvasOperationFailure).toHaveBeenCalledWith(rejection))

  runCanvasNode.mockRejectedValueOnce(new Error('供应商失败'))
  runCanvasNodeFromUser('node-2')
  await settle()
  expect(reportCanvasOperationFailure).toHaveBeenCalledTimes(1)
})

it('正文没挂着或在远景里看不见时，失败原因走画布提示条；已有弹窗在说明原因的不重复', async () => {
  isCanvasNodeBodyVisible.mockReturnValue(false)
  const failure = new Error('请先填写提示词')
  runCanvasNode.mockRejectedValueOnce(failure)
  runCanvasNodeFromUser('node-1')
  await vi.waitFor(() => expect(reportCanvasOperationFailure).toHaveBeenCalledWith(failure))

  useAlertDialogStore.setState({ queue: [{ title: '还没有配置密钥', message: '' }] })
  runCanvasNode.mockRejectedValueOnce(new Error('还没有配置密钥'))
  runCanvasNodeFromUser('node-2')
  await settle()
  expect(reportCanvasOperationFailure).toHaveBeenCalledTimes(1)
})
