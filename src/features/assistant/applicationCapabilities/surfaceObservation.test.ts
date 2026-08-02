// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  save: vi.fn(),
  collect: vi.fn(),
  inspect: vi.fn(),
}))

vi.mock('@/platform', () => ({
  getPlatform: () => ({ media: { captureApplicationSurface: mocks.capture } }),
}))
vi.mock('@/utils/save/uploads', () => ({ saveBase64ToUploads: mocks.save }))
vi.mock('@/features/assets/services/assetCollectionService', () => ({
  addMediaReferenceToLibrary: mocks.collect,
}))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: mocks.inspect, inspectAssets: vi.fn() }))

import { observeApplicationSurface } from './surfaceObservation'

describe('observeApplicationSurface', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    mocks.capture.mockResolvedValue({
      dataUrl: 'data:image/png;base64,YQ==', width: 800, height: 600, maskedRegionCount: 1,
    })
    mocks.save.mockResolvedValue({ fullPath: 'D:/safe/observation.png', displaySrc: 'henji-media://safe', relativePath: 'observation.png' })
    mocks.collect.mockResolvedValue({ id: 'observed-asset' })
    mocks.inspect.mockResolvedValue({
      id: 'observed-asset', mediaType: 'image', mimeType: 'image/png', sizeBytes: 128,
      width: 800, height: 600, displayName: 'observation.png', inspectionStatus: 'ready',
      displayUrl: 'henji-media://safe',
    })
  })

  it('只截取注册表面并提交表面内的敏感字段遮罩', async () => {
    const surface = document.createElement('div')
    surface.dataset.applicationSurfaceId = 'settings.api_keys'
    Object.defineProperty(surface, 'getBoundingClientRect', {
      value: () => new DOMRect(20, 40, 800, 600),
    })
    const input = document.createElement('input')
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => new DOMRect(80, 100, 240, 36),
    })
    surface.append(input)
    document.body.append(surface)

    const result = await observeApplicationSurface(
      { surfaceId: 'settings.api_keys', purpose: '确认密钥配置状态' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      surfaceId: 'settings.api_keys',
      rect: { x: 20, y: 40, width: 800, height: 600 },
      masks: [{ x: 60, y: 60, width: 240, height: 36 }],
      maskPolicyId: 'surface.mask_sensitive_fields',
    }))
    expect(result).toMatchObject({
      providerId: 'surface.region_observer',
      verificationKind: 'visual_pending_model',
      attachment: { mediaRef: 'asset:observed-asset' },
    })
  })

  it('富文本编辑器和显式敏感区域同样进入遮罩清单', async () => {
    const surface = document.createElement('div')
    surface.dataset.applicationSurfaceId = 'settings.assistant_preferences'
    Object.defineProperty(surface, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 0, 800, 600),
    })
    // ProseMirror 提示词编辑器：运行时才有 contenteditable，不是 <input>。
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    Object.defineProperty(editor, 'getBoundingClientRect', {
      value: () => new DOMRect(10, 20, 400, 200),
    })
    // 展示本地绝对路径的状态行：纯文本，只能靠显式标注。
    const status = document.createElement('p')
    status.setAttribute('data-observation-sensitive', '')
    Object.defineProperty(status, 'getBoundingClientRect', {
      value: () => new DOMRect(10, 300, 500, 20),
    })
    surface.append(editor, status)
    document.body.append(surface)

    await observeApplicationSurface(
      { surfaceId: 'settings.assistant_preferences', purpose: '确认助手偏好' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      masks: [
        { x: 10, y: 20, width: 400, height: 200 },
        { x: 10, y: 300, width: 500, height: 20 },
      ],
      maskPolicyId: 'surface.mask_sensitive_fields',
    }))
  })

  it('滚动到捕获区域之外的敏感元素不产生贴边黑条', async () => {
    const surface = document.createElement('div')
    surface.dataset.applicationSurfaceId = 'settings.storage'
    Object.defineProperty(surface, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 200, 800, 400),
    })
    // 已滚出内容区、位于捕获区域上方的输入框：完全不相交，应该整条丢弃。
    const scrolledAway = document.createElement('input')
    Object.defineProperty(scrolledAway, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 40, 600, 36),
    })
    // 半进半出的输入框：只遮住落在捕获区域内的那部分。
    const partial = document.createElement('input')
    Object.defineProperty(partial, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 180, 600, 60),
    })
    surface.append(scrolledAway, partial)
    document.body.append(surface)

    await observeApplicationSurface(
      { surfaceId: 'settings.storage', purpose: '确认存储路径' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      masks: [{ x: 0, y: 0, width: 600, height: 40 }],
    }))
  })

  it('Surface 不可见时拒绝降级为整窗或桌面截图', async () => {
    await expect(observeApplicationSurface(
      { surfaceId: 'workspace.canvas', purpose: '检查画布' },
      new AbortController().signal
    )).rejects.toThrow('SURFACE_NOT_VISIBLE')
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
