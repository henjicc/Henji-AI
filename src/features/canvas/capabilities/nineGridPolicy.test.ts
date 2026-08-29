import { describe, expect, it } from 'vitest'

import {
  NINE_GRID_PROMPT_TEMPLATE_VERSION,
  NINE_GRID_PRESET_ID,
  createGridSplitCompletionId,
  createNineGridNodeInitialData,
  createStoryboardGridOutputContract,
  normalizeNineGridStoryboardData,
} from './nineGridPolicy'

describe('九宫格预置与输出契约', () => {
  it('创建固定 3×3 且带版本的分镜预置', () => {
    const data = createNineGridNodeInitialData()
    expect(data).toMatchObject({
      displayName: '九宫格',
      capabilityId: 'image.nine-grid',
      gridRows: 3,
      gridCols: 3,
      storyboardPreset: NINE_GRID_PRESET_ID,
      promptTemplateVersion: NINE_GRID_PROMPT_TEMPLATE_VERSION,
    })
    expect(data.frames).toHaveLength(9)
    expect(new Set(data.frames.map((frame) => frame.id)).size).toBe(9)
  })

  it('保留九格描述并修复被损坏的固定语义', () => {
    const data: DynamicValueMap = {
      storyboardPreset: NINE_GRID_PRESET_ID,
      promptTemplateVersion: 'unknown',
      gridRows: 8,
      gridCols: 1,
      frames: [{ id: 'kept', description: '特写', referenceIndex: 0 }],
    }
    normalizeNineGridStoryboardData(data)
    expect(data).toMatchObject({
      gridRows: 3,
      gridCols: 3,
      promptTemplateVersion: NINE_GRID_PROMPT_TEMPLATE_VERSION,
    })
    expect(data.frames).toHaveLength(9)
    expect(data.frames[0]).toMatchObject({ id: 'kept', description: '特写', referenceIndex: 0 })
  })

  it('单张组合图保留网格语义但不伪造九个成员', () => {
    const contract = createStoryboardGridOutputContract({
      sources: ['/grid.png'],
      rows: 3,
      cols: 3,
    })
    expect(contract).toMatchObject({
      strategy: 'single',
      resultKind: 'image',
      expectedOutputCount: 1,
    })
    expect(contract.outputs).toHaveLength(1)
    expect(contract.outputs[0].descriptor).toMatchObject({
      semantic: { kind: 'grid-composite', resultKind: 'image' },
      metadata: { gridRows: 3, gridCols: 3, cellCount: 9 },
    })
  })

  it('九张独立图按阅读顺序构造原子素材组', () => {
    const contract = createStoryboardGridOutputContract({
      sources: Array.from({ length: 9 }, (_, index) => `/cell-${index + 1}.png`),
      rows: 3,
      cols: 3,
      frameNotes: Array.from({ length: 9 }, (_, index) => `镜头 ${index + 1}`),
    })
    expect(contract).toMatchObject({
      strategy: 'assetGroup',
      resultKind: 'image-group',
      expectedOutputCount: 9,
    })
    expect(contract.outputs.map((item) => item.descriptor.semantic.label)).toEqual([
      '宫格 01', '宫格 02', '宫格 03', '宫格 04', '宫格 05',
      '宫格 06', '宫格 07', '宫格 08', '宫格 09',
    ])
    expect(contract.outputs[8].descriptor.metadata).toMatchObject({
      row: 2,
      column: 2,
      note: '镜头 9',
    })
  })

  it('拒绝零输出和不完整的多图结果', () => {
    expect(() => createStoryboardGridOutputContract({ sources: [], rows: 3, cols: 3 }))
      .toThrow('预期 1 张组合图或 9 张独立图')
    expect(() => createStoryboardGridOutputContract({
      sources: ['/1.png', '/2.png'],
      rows: 3,
      cols: 3,
    })).toThrow('实际 2 张')
  })

  it('切分完成键对同一来源与参数稳定，来源变更时改变', () => {
    const input = {
      sourceNodeId: 'source',
      sourceImageUrl: '/image-a.png',
      rows: 3,
      cols: 3,
      lineThicknessPercent: 0.5,
    }
    expect(createGridSplitCompletionId(input)).toBe(createGridSplitCompletionId(input))
    expect(createGridSplitCompletionId(input)).not.toBe(createGridSplitCompletionId({
      ...input,
      sourceImageUrl: '/image-b.png',
    }))
  })
})
