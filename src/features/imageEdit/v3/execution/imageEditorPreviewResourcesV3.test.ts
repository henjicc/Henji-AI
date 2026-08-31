import { describe, expect, it, vi } from 'vitest'

import { ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditorV3FastProxy } from '@/platform/contracts/imageEditorV3'
import { ImageEditorPreviewResourceLoaderV3 } from './imageEditorPreviewResourcesV3'

const RESOURCE_REF = `sha256:${'a'.repeat(64)}` as const

describe('ImageEditorPreviewResourceLoaderV3', () => {
  it('渲染 revision 被替代时保留同源代理 singleflight，后续任务复用同一次读取', async () => {
    const proxyResolver = {
      current: null as ((proxy: ImageEditorV3FastProxy) => void) | null,
    }
    const readFastProxy = vi.fn(() => new Promise<ImageEditorV3FastProxy>((resolve) => {
      proxyResolver.current = resolve
    }))
    const budget = new ImageEditResourceBudget()
    const loader = new ImageEditorPreviewResourceLoaderV3({
      sessionId: 'singleflight-session',
      budget,
      proxyReader: readFastProxy,
      pyramidPrewarmEnabled: false,
    })
    const request = [{
      kind: 'image-proxy' as const,
      resourceId: RESOURCE_REF,
      maxDimension: 960,
    }]
    const firstController = new AbortController()
    const first = loader.load(request, 'preview-1', 8, firstController.signal)
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const second = loader.load(request, 'preview-2', 8, new AbortController().signal)
    expect(readFastProxy).toHaveBeenCalledTimes(1)
    const publishProxy = proxyResolver.current
    if (!publishProxy) throw new Error('代理读取没有进入 singleflight')
    publishProxy({
      resourceRef: RESOURCE_REF,
      width: 320,
      height: 180,
      mediaType: 'image/webp',
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    })

    await expect(second).resolves.toMatchObject({
      proxies: [expect.objectContaining({ resourceRef: RESOURCE_REF })],
      transientLeases: [],
    })
    expect(budget.snapshot().leaseCount).toBe(1)
    loader.dispose()
    expect(budget.snapshot().leaseCount).toBe(0)
  })
})
