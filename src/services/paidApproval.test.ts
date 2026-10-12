import { beforeEach, expect, it, vi } from 'vitest'
import { applicationPaidRequest } from './paidApproval'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'

const ports = vi.hoisted(() => ({ findDocument: vi.fn(), findProject: vi.fn(), target: vi.fn() }))
vi.mock('@/features/documents/documentOperations', () => ({ getDocumentOperations: () => ports }))
vi.mock('@/features/canvas/application/imageEditDocumentProjectionBinding', () => ({ findCanvasImageEditDocumentTarget: ports.target }))
beforeEach(() => {
  vi.resetAllMocks()
  ports.findProject.mockResolvedValue({ id: 'project', name: '测试项目' })
})
const missing = () => Object.assign(new Error('找不到文档'), { name: 'DocumentNotFoundError' })
it('界面与 AI 均查询真实项目，图片引用解码；工具箱没有项目授权', async () => {
  ports.findDocument.mockResolvedValue({ container: { kind: 'project', projectId: 'project' } })
  expect(await applicationPaidRequest('generation', 'document')).toMatchObject({ project: { id: 'project' } })
  const controller = new AbortController()
  const release = bindApplicationConfirmation(controller.signal, async () => {})
  try {
    ports.findDocument.mockResolvedValue({ container: { kind: 'project', projectId: 'project' } })
    expect(await applicationPaidRequest('generation', { kind: 'image_edit.document', id: 'v3:doc%3A1' }, controller.signal, 1))
      .toMatchObject({ estimatedCny: 1, project: { id: 'project', name: '测试项目' } })
    expect(ports.findDocument).toHaveBeenLastCalledWith('doc:1')
    ports.findDocument.mockRejectedValue(missing())
    expect(await applicationPaidRequest('generation', { kind: 'image_edit.document', id: 'v3:toolbox' }, controller.signal))
      .toEqual({ category: 'generation', estimatedCny: null })
  } finally { release() }
})
it('画布内嵌图片沿正式关联找到项目，不把图片工作副本当成项目', async () => {
  const controller = new AbortController(), release = bindApplicationConfirmation(controller.signal, async () => {})
  try {
    ports.findDocument.mockRejectedValueOnce(missing()).mockResolvedValueOnce({ container: { kind: 'project', projectId: 'project' } })
    ports.target.mockResolvedValue({ projectId: 'canvas' })
    expect(await applicationPaidRequest('explanation', { kind: 'image_edit.document', id: 'v3:embedded' }, controller.signal))
      .toMatchObject({ project: { id: 'project' } })
    expect(ports.target).toHaveBeenCalledWith('embedded')
    expect(ports.findDocument).toHaveBeenLastCalledWith('canvas')
    ports.findDocument.mockRejectedValue(new Error('读取失败'))
    await expect(applicationPaidRequest('explanation', { kind: 'image_edit.document', id: 'v3:embedded' }, controller.signal)).rejects.toThrow('读取失败')
  } finally { release() }
})
