import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import {
  NINE_GRID_PRESET_ID,
  NINE_GRID_PROMPT_TEMPLATE_VERSION,
  createNineGridNodeInitialData,
} from '@/features/canvas/capabilities/nineGridPolicy'

const {
  runCanvasGeneration,
  prepareNodeImage,
  embedStoryboardImageMetadata,
} = vi.hoisted(() => ({
  runCanvasGeneration: vi.fn(),
  prepareNodeImage: vi.fn(),
  embedStoryboardImageMetadata: vi.fn(),
}))

vi.mock('@/features/canvas/generation/runGeneration', () => ({ runCanvasGeneration }))
vi.mock('@/features/canvas/application/imageData', () => ({ prepareNodeImage }))
vi.mock('@/commands/image', () => ({ embedStoryboardImageMetadata }))
vi.mock('./shared', () => ({ generateGridImageDataUrl: () => 'data:image/png;base64,grid' }))

import { buildStoryboardPrompt, generateStoryboardImage } from './generation'
import { createStoryboardGenerationResumeContext } from '@/features/canvas/application/storyboardGenerationOutputService'

function nodeData(): StoryboardGenNodeData {
  return {
    ...createNineGridNodeInitialData(),
    modelId: 'test-image-model',
    params: {},
    mediaInputs: {},
    imageUrl: null,
    aspectRatio: '1:1',
  }
}

function generationInput() {
  const data = nodeData()
  const frameDescriptionDrafts = Object.fromEntries(
    data.frames.map((frame) => [frame.id, frame.description]),
  )
  return {
    modelId: 'test-image-model',
    params: { prompt: '九宫格' },
    incomingImages: ['/source.png'],
    frameAspectRatioValue: '1:1',
    gridImageResolution: '2K',
    resumeContext: createStoryboardGenerationResumeContext({
      gridRows: data.gridRows,
      gridCols: data.gridCols,
      frames: data.frames,
      frameDescriptionDrafts,
      ignoreAtTagWhenCopyingAndGenerating: false,
    }),
  }
}

describe('分镜生成的九宫格双形态输出', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareNodeImage.mockResolvedValue({
      imageUrl: '/managed/grid.png',
      previewImageUrl: '/managed/grid-preview.png',
      aspectRatio: '1:1',
    })
    embedStoryboardImageMetadata.mockResolvedValue('/managed/grid-metadata.png')
  })

  it('版本化九宫格预置编译固定 3×3 提示词', () => {
    const data = nodeData()
    data.frames[0].description = '主体正面'
    const prompt = buildStoryboardPrompt({
      nodeData: data,
      frameDescriptionDrafts: { [data.frames[0].id]: '主体正面' },
      keepStyleConsistent: true,
      disableTextInImage: true,
      autoInferEmptyFrame: false,
    })
    expect(data).toMatchObject({
      storyboardPreset: NINE_GRID_PRESET_ID,
      promptTemplateVersion: NINE_GRID_PROMPT_TEMPLATE_VERSION,
    })
    expect(prompt).toContain('固定 3×3 的九宫格')
    expect(prompt).toContain('分镜1：主体正面')
  })

  it('单张组合图落盘并嵌入网格元数据', async () => {
    runCanvasGeneration.mockResolvedValue({ outputs: ['/remote/grid.png'], primary: '/remote/grid.png' })
    const onTaskId = vi.fn()
    const result = await generateStoryboardImage({ ...generationInput(), onTaskId })
    expect(runCanvasGeneration).toHaveBeenCalledWith(expect.objectContaining({ onTaskId }))
    expect(prepareNodeImage).toHaveBeenCalledWith('/remote/grid.png')
    expect(embedStoryboardImageMetadata).toHaveBeenCalledWith('/managed/grid.png', {
      gridRows: 3,
      gridCols: 3,
      frameNotes: Array.from({ length: 9 }, () => ''),
    })
    expect(result.contract).toMatchObject({
      strategy: 'single',
      outputs: [{ source: '/managed/grid-metadata.png' }],
    })
  })

  it('九张独立图不伪嵌入组合图元数据，直接交给素材组', async () => {
    const outputs = Array.from({ length: 9 }, (_, index) => `/remote/${index + 1}.png`)
    runCanvasGeneration.mockResolvedValue({ outputs, primary: outputs[0] })
    const result = await generateStoryboardImage(generationInput())
    expect(prepareNodeImage).not.toHaveBeenCalled()
    expect(embedStoryboardImageMetadata).not.toHaveBeenCalled()
    expect(result.contract).toMatchObject({
      strategy: 'assetGroup',
      resultKind: 'image-group',
      expectedOutputCount: 9,
    })
    expect(result.contract.outputs.map((item) => item.source)).toEqual(outputs)
  })

  it('不完整的多图输出明确失败', async () => {
    runCanvasGeneration.mockResolvedValue({
      outputs: ['/remote/1.png', '/remote/2.png'],
      primary: '/remote/1.png',
    })
    await expect(generateStoryboardImage(generationInput())).rejects.toThrow('实际 2 张')
  })
})
