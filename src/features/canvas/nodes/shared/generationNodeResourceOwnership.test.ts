import { describe, expect, it, vi } from 'vitest'

import type { GenerationNodeResourceOwnership } from './generationNodeResourceOwnership'
import {
  collectGenerationNodeTemporaryFiles,
  runWithGenerationNodeResourceCleanup,
} from './generationNodeResourceOwnership'

function createOwnership(
  modelType: GenerationNodeResourceOwnership['modelType'] = 'image',
): GenerationNodeResourceOwnership {
  return {
    modelType,
    requestPreparation: {
      createdFilePaths: ['/managed/crop.png', '/managed/shared.png'],
    },
    generationResult: null,
  }
}

describe('生成节点临时资源所有权', () => {
  it('图片执行合并前处理与 Runtime 新建文件并去重', () => {
    const ownership = createOwnership()
    ownership.generationResult = {
      outputs: ['/managed/result.png'],
      primary: '/managed/result.png',
      createdFilePaths: ['/managed/shared.png', '/managed/result.png'],
    }

    expect(collectGenerationNodeTemporaryFiles(ownership)).toEqual([
      '/managed/crop.png',
      '/managed/shared.png',
      '/managed/result.png',
    ])
  })

  it.each(['video', 'audio'] as const)(
    '%s 结果仍是节点权威媒体，只回收请求前处理文件',
    (modelType) => {
      const ownership = createOwnership(modelType)
      ownership.generationResult = {
        outputs: [`/managed/result.${modelType}`],
        primary: `/managed/result.${modelType}`,
        createdFilePaths: [`/managed/result.${modelType}`],
      }

      expect(collectGenerationNodeTemporaryFiles(ownership)).toEqual([
        '/managed/crop.png',
        '/managed/shared.png',
      ])
    },
  )

  it.each([
    ['估价失败', false],
    ['模型生成失败', false],
    ['取消', true],
    ['项目切换', true],
  ] as const)('%s 时仍经 finally 释放当前已取得的所有权', async (message, hasResult) => {
    const ownership = createOwnership()
    const release = vi.fn().mockResolvedValue(undefined)

    await expect(runWithGenerationNodeResourceCleanup({
      ownership,
      operation: async () => {
        if (hasResult) {
          ownership.generationResult = {
            outputs: ['/managed/result.png'],
            primary: '/managed/result.png',
            createdFilePaths: ['/managed/result.png'],
          }
        }
        throw new Error(message)
      },
      release,
    })).rejects.toThrow(message)

    expect(release).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledWith(hasResult
      ? ['/managed/crop.png', '/managed/shared.png', '/managed/result.png']
      : ['/managed/crop.png', '/managed/shared.png'])
  })

  it('成功后释放资源，且回收或日志失败都不覆盖成功结果', async () => {
    const ownership = createOwnership()
    const onReleaseError = vi.fn(() => { throw new Error('logger failed') })

    await expect(runWithGenerationNodeResourceCleanup({
      ownership,
      operation: async () => 'completed',
      release: vi.fn().mockRejectedValue(new Error('release failed')),
      onReleaseError,
    })).resolves.toBe('completed')

    expect(onReleaseError).toHaveBeenCalledWith(expect.any(Error), 2)
  })

  it('执行失败时回收失败不会覆盖原始错误', async () => {
    const ownership = createOwnership()

    await expect(runWithGenerationNodeResourceCleanup({
      ownership,
      operation: async () => { throw new Error('generation failed') },
      release: vi.fn().mockRejectedValue(new Error('release failed')),
    })).rejects.toThrow('generation failed')
  })
})
