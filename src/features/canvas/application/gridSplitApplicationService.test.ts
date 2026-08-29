import { describe, expect, it, vi } from 'vitest'

import type { StoryboardFrameItem } from '../domain/canvasNodes'
import type { CommitCanvasGenerationOutputsInput } from './generationOutputApplicationService'
import { commitGridSplitResult } from './gridSplitApplicationService'

function frames(count: number): StoryboardFrameItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `frame-${index + 1}`,
    imageUrl: `/frame-${index + 1}.png`,
    previewImageUrl: `/frame-${index + 1}.png`,
    aspectRatio: '1:1',
    note: `镜头 ${index + 1}`,
    order: index,
  }))
}

describe('宫格切分结果提交', () => {
  it('委托 4.1 唯一多结果服务构造九张原子素材组', async () => {
    const commit = vi.fn(async (input: CommitCanvasGenerationOutputsInput) => ({
      projectId: 'project',
      completionId: input.completionId ?? '',
      strategy: input.contract.strategy,
      resultNodeIds: input.contract.outputs.map((item) => item.descriptor.outputId),
      groupNodeId: 'group',
      idempotent: false,
    }))

    const result = await commitGridSplitResult({
      sourceNodeId: 'source',
      sourceImageUrl: '/grid.png',
      rows: 3,
      cols: 3,
      lineThicknessPercent: 0.5,
      frames: frames(9),
    }, commit)

    expect(result).toMatchObject({ strategy: 'assetGroup', groupNodeId: 'group' })
    expect(commit).toHaveBeenCalledOnce()
    const request = commit.mock.calls[0][0]
    expect(request.placeholderNodeId).toBeUndefined()
    expect(request.contract).toMatchObject({
      strategy: 'assetGroup',
      resultKind: 'image-group',
      expectedOutputCount: 9,
    })
    expect(request.contract.outputs.map((item) => item.descriptor.semantic.kind))
      .toEqual(Array.from({ length: 9 }, () => 'grid-cell'))
  })

  it('格子缺失或数量不完整时不提交半成品', async () => {
    const commit = vi.fn()
    const incomplete = frames(9)
    incomplete[4].imageUrl = null
    await expect(commitGridSplitResult({
      sourceNodeId: 'source',
      sourceImageUrl: '/grid.png',
      rows: 3,
      cols: 3,
      frames: incomplete,
    }, commit)).rejects.toThrow('第 5 格缺少图片结果')
    await expect(commitGridSplitResult({
      sourceNodeId: 'source',
      sourceImageUrl: '/grid.png',
      rows: 3,
      cols: 3,
      frames: frames(8),
    }, commit)).rejects.toThrow('实际 8 张')
    expect(commit).not.toHaveBeenCalled()
  })

  it('相同来源与参数重复执行使用同一完成键', async () => {
    const completionIds: string[] = []
    const commit = vi.fn(async (input: CommitCanvasGenerationOutputsInput) => {
      completionIds.push(input.completionId ?? '')
      return {
        projectId: 'project',
        completionId: input.completionId ?? '',
        strategy: input.contract.strategy,
        resultNodeIds: [],
        groupNodeId: 'group',
        idempotent: completionIds.length > 1,
      }
    })
    const input = {
      sourceNodeId: 'source',
      sourceImageUrl: '/grid.png',
      rows: 3,
      cols: 3,
      lineThicknessPercent: 0,
      frames: frames(9),
    }
    await commitGridSplitResult(input, commit)
    await commitGridSplitResult(input, commit)
    expect(completionIds[0]).toBe(completionIds[1])
  })
})
