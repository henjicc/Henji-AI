import { describe, expect, it } from 'vitest'
import { createCanvasGenerationFailurePatch, isLayerStackDownloadFailure } from './generationFailure'

describe('多图层生成失败恢复边界', () => {
  it('跨 IPC 与 GenerationService 包装后仍保留下载失败的原任务', () => {
    const patch = createCanvasGenerationFailurePatch(
      new Error('Continue polling failed for kie-seedream-5.0-pro: [media_download_failed] interrupted'),
      'layer-stack',
    )
    expect(patch).toMatchObject({ isGenerating: false, generationError: '图片已生成，但下载未完成。请重试获取结果。' })
    expect(patch).not.toHaveProperty('serverTaskId')
    expect(patch).not.toHaveProperty('serverTaskModelId')
  })

  it('供应商确定失败、取消与其他结果类型保持原终态清理', () => {
    for (const [error, resultKind] of [
      ['[task_failed] rejected', 'layer-stack'],
      ['[cancelled] cancelled', 'layer-stack'],
      ['[media_download_failed] interrupted', 'image'],
    ]) {
      expect(createCanvasGenerationFailurePatch(new Error(error), resultKind))
        .toMatchObject({ isGenerating: false, serverTaskId: null, serverTaskModelId: null, generationError: error })
    }
  })

  it('只兼容旧续查包装的 terminated，不把任意终止消息认作下载失败', () => {
    expect(isLayerStackDownloadFailure({
      resultKind: 'layer-stack', generationError: 'Continue polling failed for kie-seedream-5.0-pro: terminated',
    })).toBe(true)
    expect(isLayerStackDownloadFailure({ resultKind: 'layer-stack', generationError: 'terminated' })).toBe(false)
    expect(isLayerStackDownloadFailure({ resultKind: 'image', generationError: '[media_download_failed] terminated' })).toBe(false)
  })
})
