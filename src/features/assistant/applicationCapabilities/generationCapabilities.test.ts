import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  database,
  offerImageEditorHandoff,
  openApplicationSurface,
  readImageInfo,
  getDataRoot,
  convertPathString,
  createImageEditPreview,
  getStoredImageEditPreview,
} = vi.hoisted(() => ({
  database: {
    init: vi.fn(async () => undefined),
    getHistory: vi.fn(),
    getHistoryById: vi.fn(),
  },
  offerImageEditorHandoff: vi.fn(),
  openApplicationSurface: vi.fn(),
  readImageInfo: vi.fn(),
  getDataRoot: vi.fn(),
  convertPathString: vi.fn(),
  createImageEditPreview: vi.fn(),
  getStoredImageEditPreview: vi.fn(),
}))

vi.mock('@/services/database', () => ({ databaseService: database }))
vi.mock('@/commands/image', () => ({ readImageInfo }))
vi.mock('@/utils/dataPath', () => ({ getDataRoot, convertPathString }))
vi.mock('@/features/imageEdit/store/imageEditorHandoffStore', () => ({
  offerImageEditorHandoff,
}))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: vi.fn() }))
vi.mock('@/features/imageEdit/application/imageEditApplicationService', () => ({
  createImageEditPreview,
}))
vi.mock('@/features/imageEdit/application/imageEditSessionRegistry', () => ({
  getStoredImageEditPreview,
}))
vi.mock('./surfaceRegistry', () => ({ openApplicationSurface }))

import {
  createImageEditPreviewFromRef,
  listGenerationHistory,
  openImageEditorWithSource,
} from './generationCapabilities'
import {
  createGenerationReflectionRegistrations,
  GENERATION_ENTITY_TYPES,
} from '@/features/generation/application/generationReflection'

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
    openApplicationSurface.mockImplementation((surfaceId: string) => ({ surfaceId }))
    getStoredImageEditPreview.mockReturnValue(null)
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

  it('生成历史返回的 generation.record 引用可通过通用反射读取', async () => {
    const history = await listGenerationHistory({ mediaType: 'image', status: 'success', limit: 10 })
    const ref = history.records[0]?.ref
    expect(ref).toEqual({
      kind: GENERATION_ENTITY_TYPES.record,
      id: 'history-1',
      label: '测试图片',
    })
    const registration = createGenerationReflectionRegistrations().find((item) => (
      item.entity.id === GENERATION_ENTITY_TYPES.record
    ))
    if (!registration?.provider) throw new Error('GENERATION_RECORD_PROVIDER_MISSING')

    const recordSnapshot = await registration.provider.readEntity(ref as {
      kind: typeof GENERATION_ENTITY_TYPES.record
      id: string
      label: string
    }, {})

    expect(recordSnapshot).toMatchObject({
      ref,
      properties: {
        'generation.record.model_ref': { kind: 'generation.model', id: 'image-model' },
        'generation.record.result_ref': { kind: 'generation.result', id: 'history-1' },
        'generation.record.media_type': 'image',
        'generation.record.status': 'success',
        'generation.record.prompt': '测试图片',
      },
    })
    const resultRef = recordSnapshot?.properties['generation.record.result_ref']
    expect(resultRef).toEqual({ kind: GENERATION_ENTITY_TYPES.result, id: 'history-1' })
    const resultRegistration = createGenerationReflectionRegistrations().find((item) => (
      item.entity.id === GENERATION_ENTITY_TYPES.result
    ))
    if (!resultRegistration?.provider) throw new Error('GENERATION_RESULT_PROVIDER_MISSING')
    await expect(resultRegistration.provider.readEntity(resultRef as {
      kind: typeof GENERATION_ENTITY_TYPES.result
      id: string
    }, {})).resolves.toMatchObject({
      ref: resultRef,
      properties: {
        'generation.result.task_ref': null,
        'generation.result.record_ref': { kind: GENERATION_ENTITY_TYPES.record, id: 'history-1' },
        'generation.result.media_type': 'image',
        'generation.result.media_ref': resultRef,
      },
    })
    expect(JSON.stringify(recordSnapshot)).not.toContain('Media/generated.png')
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
    expect(openApplicationSurface).toHaveBeenCalledWith('tool.image_edit', {})
    expect(offerImageEditorHandoff).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: 'C:/Henji-AI/Media/generated.png',
    }))
    expect(result).toMatchObject({ surfaceId: 'tool.image_edit' })
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
    expect(openApplicationSurface).not.toHaveBeenCalled()
  })

  it('后台创建标注预览时使用已还原的绝对路径且不抢占当前界面', async () => {
    createImageEditPreview.mockResolvedValue({
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

    const result = await createImageEditPreviewFromRef({
      sourceRef: { kind: 'generation.result', id: 'history-1' },
      operations: [{ type: 'rectangle' }],
    })
    expect(result).toMatchObject({
      resultRefs: [{ kind: 'image_edit.preview', id: 'image-edit-preview:1' }],
    })

    expect(createImageEditPreview).toHaveBeenCalledWith({
      sourceRef: 'generation.result:history-1',
      source: 'C:/Henji-AI/Media/generated.png',
      operations: [{ type: 'rectangle' }],
    })
    expect(offerImageEditorHandoff).not.toHaveBeenCalled()
    expect(openApplicationSurface).not.toHaveBeenCalled()
  })

  it('显式打开预览时从正式预览存储加载同一份编辑文档', async () => {
    const document = {
      version: 2,
      operations: [{ id: 'rotate-1', type: 'geometry.rotate', enabled: true, params: { quarterTurns: 1 } }],
    }
    getStoredImageEditPreview.mockReturnValue({
      previewRef: 'image-edit-preview:2',
      sourceRef: 'generation.result:history-1',
      source: 'C:/Henji-AI/Media/generated.png',
      document,
      width: 1024,
      height: 1024,
      revision: 1,
      createdAt: 1,
    })

    const result = await openImageEditorWithSource(
      { kind: 'image_edit.preview', id: 'image-edit-preview:2' },
      { requestId: 'request-1' },
    )

    expect(offerImageEditorHandoff).toHaveBeenCalledWith(expect.objectContaining({
      sessionRef: 'image-edit-session:image_edit.preview:image-edit-preview:2',
      document,
    }))
    expect(openApplicationSurface).toHaveBeenCalledWith('tool.image_edit', {
      requestId: 'request-1',
    })
    expect(result).toMatchObject({
      sourceRef: { kind: 'image_edit.preview', id: 'image-edit-preview:2' },
      surfaceId: 'tool.image_edit',
    })
    expect(result).not.toHaveProperty('sessionRef')
  })

})
