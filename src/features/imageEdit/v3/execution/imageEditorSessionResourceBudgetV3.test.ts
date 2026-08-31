import { describe, expect, it } from 'vitest'

import {
  acquireImageEditorSessionResourceBudgetV3,
  inspectImageEditorSessionResourceBudgetV3,
} from './imageEditorSessionResourceBudgetV3'
import { ImageEditorPreviewClientV3 } from './imageEditorPreviewClientV3'
import { ImageEditorViewportCompositeClientV3 } from './viewportCompositeClientV3'

describe('图片编辑 V3 会话资源账本', () => {
  it('同一会话共享唯一预算，最后一个使用者释放后移除 registry', () => {
    const preview = acquireImageEditorSessionResourceBudgetV3('shared-session', {
      consumerId: 'preview',
      budgetOptions: {
        totalBytes: 1_000,
        cpuCacheTargetBytes: 400,
        gpuTargetBytes: 300,
      },
    })
    const viewport = acquireImageEditorSessionResourceBudgetV3('shared-session', {
      consumerId: 'viewport',
    })

    expect(viewport.budget).toBe(preview.budget)
    expect(inspectImageEditorSessionResourceBudgetV3('shared-session')).toMatchObject({
      consumers: 2,
      memory: { totalBytes: 0, leaseCount: 0 },
    })

    const memory = preview.budget.acquire('gpu', 300)
    expect(memory).not.toBeNull()
    preview.release()
    expect(inspectImageEditorSessionResourceBudgetV3('shared-session')).toMatchObject({
      consumers: 1,
      memory: { totalBytes: 300, leaseCount: 1 },
    })

    memory?.release()
    viewport.release()
    viewport.release()
    expect(inspectImageEditorSessionResourceBudgetV3('shared-session')).toBeNull()
  })

  it('不同会话不共享预算', () => {
    const left = acquireImageEditorSessionResourceBudgetV3('left-session', {
      consumerId: 'preview',
    })
    const right = acquireImageEditorSessionResourceBudgetV3('right-session', {
      consumerId: 'preview',
    })
    expect(left.budget).not.toBe(right.budget)
    left.release()
    right.release()
  })

  it('同一稳定使用者重新登记会替换旧 token，废弃构造结果不能提前释放', () => {
    const discarded = acquireImageEditorSessionResourceBudgetV3('strict-session', {
      consumerId: 'preview:react-id',
    })
    const committed = acquireImageEditorSessionResourceBudgetV3('strict-session', {
      consumerId: 'preview:react-id',
    })
    expect(inspectImageEditorSessionResourceBudgetV3('strict-session')?.consumers).toBe(1)
    discarded.release()
    expect(inspectImageEditorSessionResourceBudgetV3('strict-session')?.consumers).toBe(1)
    committed.release()
    expect(inspectImageEditorSessionResourceBudgetV3('strict-session')).toBeNull()
  })

  it('受管代理预览与视口分块客户端默认登记到同一会话账本', () => {
    const preview = new ImageEditorPreviewClientV3({
      sessionId: 'editor-session',
      workerFactory: () => ({
        onmessage: null,
        onerror: null,
        postMessage: () => undefined,
        terminate: () => undefined,
      }),
    })
    const viewport = new ImageEditorViewportCompositeClientV3({
      sessionId: 'editor-session',
      scheduler: {
        render: async () => { throw new Error('测试不应执行渲染') },
        cancel: () => undefined,
        dispose: () => undefined,
      },
      workerFactory: () => ({
        onmessage: null,
        onerror: null,
        postMessage: () => undefined,
        terminate: () => undefined,
      }),
    })

    expect(inspectImageEditorSessionResourceBudgetV3('editor-session')?.consumers).toBe(2)
    preview.dispose()
    expect(inspectImageEditorSessionResourceBudgetV3('editor-session')?.consumers).toBe(1)
    viewport.dispose()
    expect(inspectImageEditorSessionResourceBudgetV3('editor-session')).toBeNull()
  })
})
