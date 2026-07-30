import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  database,
  offerImageEditorHandoff,
  switchWorkspace,
  selectToolboxTool,
} = vi.hoisted(() => ({
  database: {
    init: vi.fn(async () => undefined),
    getHistory: vi.fn(),
    getHistoryById: vi.fn(),
  },
  offerImageEditorHandoff: vi.fn(),
  switchWorkspace: vi.fn(),
  selectToolboxTool: vi.fn(),
}))

vi.mock('@/services/database', () => ({ databaseService: database }))
vi.mock('@/features/imageEdit/store/imageEditorHandoffStore', () => ({
  offerImageEditorHandoff,
}))
vi.mock('@/stores/navigationStore', () => ({ switchWorkspace, selectToolboxTool }))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: vi.fn() }))
vi.mock('../hostActions', () => ({
  createImageEditPreviewFromApplicationRef: vi.fn(),
}))

import {
  listGenerationHistory,
  openImageEditorWithSource,
} from './generationCapabilities'

const successfulImage = {
  id: 'history-1',
  providerId: 'kie',
  modelId: 'image-model',
  type: 'image' as const,
  prompt: '测试图片',
  params: {},
  filePath: 'D:/private/generated.png',
  taskId: 'task-1',
  status: 'success' as const,
  errorMessage: null,
  cost: null,
  duration: 1,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:01.000Z',
}

describe('generation application capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.getHistory.mockResolvedValue([successfulImage])
    database.getHistoryById.mockResolvedValue(successfulImage)
  })

  it('生成历史只返回稳定引用，不返回本地路径', async () => {
    const result = await listGenerationHistory({ mediaType: 'image', status: 'success', limit: 10 })
    expect(result.records[0]).toMatchObject({
      ref: { kind: 'generation.record', id: 'history-1' },
      resultRef: { kind: 'generation.result', id: 'history-1' },
      hasResult: true,
    })
    expect(JSON.stringify(result)).not.toContain('D:/private')
  })

  it('生成结果直接进入图片编辑，不创建或切换画布', async () => {
    const result = await openImageEditorWithSource({
      kind: 'generation.result',
      id: 'history-1',
    })
    expect(switchWorkspace).toHaveBeenCalledWith('tools')
    expect(selectToolboxTool).toHaveBeenCalledWith('imageMark')
    expect(offerImageEditorHandoff).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: successfulImage.filePath,
    }))
    expect(result).toMatchObject({ surfaceId: 'tool.image_edit' })
    expect(switchWorkspace).not.toHaveBeenCalledWith('nodes')
  })
})
