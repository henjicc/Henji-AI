import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  database,
  offerImageEditorHandoff,
  switchWorkspace,
  selectToolboxTool,
  readImageInfo,
  getDataRoot,
  convertPathString,
  createImageEditPreviewFromApplicationRef,
} = vi.hoisted(() => ({
  database: {
    init: vi.fn(async () => undefined),
    getHistory: vi.fn(),
    getHistoryById: vi.fn(),
  },
  offerImageEditorHandoff: vi.fn(),
  switchWorkspace: vi.fn(),
  selectToolboxTool: vi.fn(),
  readImageInfo: vi.fn(),
  getDataRoot: vi.fn(),
  convertPathString: vi.fn(),
  createImageEditPreviewFromApplicationRef: vi.fn(),
}))

vi.mock('@/services/database', () => ({ databaseService: database }))
vi.mock('@/commands/image', () => ({ readImageInfo }))
vi.mock('@/utils/dataPath', () => ({ getDataRoot, convertPathString }))
vi.mock('@/features/imageEdit/store/imageEditorHandoffStore', () => ({
  offerImageEditorHandoff,
}))
vi.mock('@/stores/navigationStore', () => ({ switchWorkspace, selectToolboxTool }))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: vi.fn() }))
vi.mock('../hostActions', () => ({
  createImageEditPreviewFromApplicationRef,
}))

import {
  createImageEditPreviewFromRef,
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
  filePath: 'Media/generated.png',
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
    getDataRoot.mockResolvedValue('C:/Henji-AI')
    convertPathString.mockResolvedValue('C:/Henji-AI/Media/generated.png')
    readImageInfo.mockResolvedValue({
      source: 'C:/Henji-AI/Media/generated.png',
      fileName: 'generated.png',
      extension: 'png',
      width: 1024,
      height: 1024,
      fileSizeBytes: 1024,
      createdAt: null,
      modifiedAt: null,
    })
  })

  it('生成历史只返回稳定引用，不返回本地路径', async () => {
    const result = await listGenerationHistory({ mediaType: 'image', status: 'success', limit: 10 })
    expect(result.records[0]).toMatchObject({
      ref: { kind: 'generation.record', id: 'history-1' },
      resultRef: { kind: 'generation.result', id: 'history-1' },
      hasResult: true,
    })
    expect(JSON.stringify(result)).not.toContain('Media/generated.png')
  })

  it('先按当前数据根目录还原并验证图片，再进入图片编辑', async () => {
    const result = await openImageEditorWithSource({
      kind: 'generation.result',
      id: 'history-1',
    })
    expect(convertPathString).toHaveBeenCalledWith(
      successfulImage.filePath,
      'C:/Henji-AI',
      false
    )
    expect(readImageInfo).toHaveBeenCalledWith('C:/Henji-AI/Media/generated.png')
    expect(switchWorkspace).toHaveBeenCalledWith('tools')
    expect(selectToolboxTool).toHaveBeenCalledWith('imageMark')
    expect(offerImageEditorHandoff).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: 'C:/Henji-AI/Media/generated.png',
    }))
    expect(result).toMatchObject({ surfaceId: 'tool.image_edit' })
    expect(switchWorkspace).not.toHaveBeenCalledWith('nodes')
  })

  it('本地副本不可读时使用历史记录保留的远程结果', async () => {
    database.getHistoryById.mockResolvedValue({
      ...successfulImage,
      params: { __resultUrl: 'https://example.com/generated.png' },
    })
    readImageInfo
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce({
        source: 'https://example.com/generated.png',
        fileName: null,
        extension: 'png',
        width: 1024,
        height: 1024,
        fileSizeBytes: 1024,
        createdAt: null,
        modifiedAt: null,
      })

    await openImageEditorWithSource({ kind: 'generation.result', id: 'history-1' })

    expect(readImageInfo).toHaveBeenNthCalledWith(1, 'C:/Henji-AI/Media/generated.png')
    expect(readImageInfo).toHaveBeenNthCalledWith(2, 'https://example.com/generated.png')
    expect(offerImageEditorHandoff).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: 'https://example.com/generated.png',
    }))
  })

  it('图片不可读时不切换页面，也不报告打开成功', async () => {
    readImageInfo.mockRejectedValue(new Error('ENOENT'))

    await expect(openImageEditorWithSource({
      kind: 'generation.result',
      id: 'history-1',
    })).rejects.toThrow('NOT_FOUND')

    expect(offerImageEditorHandoff).not.toHaveBeenCalled()
    expect(switchWorkspace).not.toHaveBeenCalled()
    expect(selectToolboxTool).not.toHaveBeenCalled()
  })

  it('创建标注预览时使用已还原的绝对路径', async () => {
    createImageEditPreviewFromApplicationRef.mockResolvedValue({
      previewRef: 'image-edit-preview:1',
      document: {
        version: 2,
        operations: [],
      },
      operationCount: 1,
      hasEffect: true,
      width: 1024,
      height: 1024,
    })

    await createImageEditPreviewFromRef({
      sourceRef: { kind: 'generation.result', id: 'history-1' },
      operations: [{ type: 'rectangle' }],
    })

    expect(createImageEditPreviewFromApplicationRef).toHaveBeenCalledWith(
      'generation.result:history-1',
      'C:/Henji-AI/Media/generated.png',
      [{ type: 'rectangle' }]
    )
  })
})
