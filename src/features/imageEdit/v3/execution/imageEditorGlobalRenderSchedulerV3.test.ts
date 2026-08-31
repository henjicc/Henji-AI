import { describe, expect, it } from 'vitest'

import { IMAGE_EDIT_RENDER_PRIORITY } from '@/core/imageEdit/v3/renderScheduler'
import {
  getImageEditorGlobalRenderSchedulerV3,
  inspectImageEditorGlobalRenderSchedulerV3,
} from './imageEditorGlobalRenderSchedulerV3'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('图片编辑 V3 全局渲染调度器', () => {
  it('跨消费方共享同一调度器，GPU 串行并在原子任务边界优先交互', async () => {
    const exportConsumer = getImageEditorGlobalRenderSchedulerV3()
    const previewConsumer = getImageEditorGlobalRenderSchedulerV3()
    expect(previewConsumer).toBe(exportConsumer)

    const gate = deferred<void>()
    const order: string[] = []
    const firstExportTile = exportConsumer.schedule({
      id: 'global-export-tile-1',
      sessionId: 'global-export',
      revision: 1,
      kind: 'export',
      lane: 'gpu',
      priority: IMAGE_EDIT_RENDER_PRIORITY.export,
      run: async () => {
        order.push('export-1')
        await gate.promise
      },
    })
    const secondExportTile = exportConsumer.schedule({
      id: 'global-export-tile-2',
      sessionId: 'global-export',
      revision: 1,
      kind: 'export',
      lane: 'gpu',
      priority: IMAGE_EDIT_RENDER_PRIORITY.export,
      run: async () => { order.push('export-2') },
    })
    const preview = previewConsumer.schedule({
      id: 'global-preview-frame',
      sessionId: 'global-preview',
      revision: 2,
      kind: 'preview',
      lane: 'gpu',
      priority: IMAGE_EDIT_RENDER_PRIORITY.interactionDraft,
      run: async () => { order.push('preview') },
    })

    expect(order).toEqual(['export-1'])
    expect(inspectImageEditorGlobalRenderSchedulerV3()).toMatchObject({
      runningGpu: 1,
      pendingPreviewSessions: 1,
      pendingOtherTasks: 1,
    })
    gate.resolve()
    await Promise.all([firstExportTile, secondExportTile, preview])
    expect(order).toEqual(['export-1', 'preview', 'export-2'])
    expect(inspectImageEditorGlobalRenderSchedulerV3()).toMatchObject({
      runningGpu: 0,
      pendingPreviewSessions: 0,
      pendingOtherTasks: 0,
    })
  })
})
