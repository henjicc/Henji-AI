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


  it('默认整窗观察：不依赖任何页面可见，捕获整个视口', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1280, configurable: true })
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true })

    const result = await observeApplicationSurface(
      { target: 'window', purpose: '看看当前界面什么状态' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      target: 'window',
      rect: { x: 0, y: 0, width: 1280, height: 800 },
      masks: [],
      maskPolicyId: 'surface.mask_declared_fields',
    }))
    expect(result).toMatchObject({
      target: 'window',
      providerId: 'application.window_observer',
      sourceKind: 'application_window',
      verificationKind: 'visual_pending_model',
      attachment: { mediaRef: 'asset:observed-asset' },
    })
  })

  it('普通输入框和富文本编辑器不再被涂黑，只遮显式标记区域', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true })
    // 密钥框本身是 password，界面上就显示圆点，截图同样是圆点，不需要额外遮罩。
    const password = document.createElement('input')
    password.type = 'password'
    Object.defineProperty(password, 'getBoundingClientRect', { value: () => new DOMRect(10, 10, 300, 32) })
    // 提示词编辑器：涂黑它只会让整窗观察失去意义。
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => new DOMRect(10, 60, 400, 200) })
    // 明文本地路径：唯一需要遮的那类，靠显式标记。
    const status = document.createElement('p')
    status.setAttribute('data-observation-sensitive', '')
    Object.defineProperty(status, 'getBoundingClientRect', { value: () => new DOMRect(10, 300, 500, 20) })
    document.body.append(password, editor, status)

    await observeApplicationSurface(
      { target: 'window', purpose: '确认界面状态' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      masks: [{ x: 10, y: 300, width: 500, height: 20 }],
    }))
  })

  it('指定页面时只截该页面，并保留敏感遮罩策略', async () => {
    const surface = document.createElement('div')
    surface.dataset.applicationSurfaceId = 'settings.api_keys'
    Object.defineProperty(surface, 'getBoundingClientRect', {
      value: () => new DOMRect(20, 40, 800, 600),
    })
    const status = document.createElement('p')
    status.setAttribute('data-observation-sensitive', '')
    Object.defineProperty(status, 'getBoundingClientRect', {
      value: () => new DOMRect(80, 100, 240, 36),
    })
    surface.append(status)
    document.body.append(surface)

    const result = await observeApplicationSurface(
      { target: 'settings.api_keys', purpose: '确认密钥配置状态' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      target: 'settings.api_keys',
      rect: { x: 20, y: 40, width: 800, height: 600 },
      masks: [{ x: 60, y: 60, width: 240, height: 36 }],
      maskPolicyId: 'surface.mask_sensitive_fields',
    }))
    expect(result).toMatchObject({ target: 'settings.api_keys', sourceKind: 'surface_region' })
  })

  it('滚动到捕获区域之外的敏感元素不产生贴边黑条', async () => {
    const surface = document.createElement('div')
    surface.dataset.applicationSurfaceId = 'settings.storage'
    Object.defineProperty(surface, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 200, 800, 400),
    })
    const scrolledAway = document.createElement('p')
    scrolledAway.setAttribute('data-observation-sensitive', '')
    Object.defineProperty(scrolledAway, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 40, 600, 36),
    })
    const partial = document.createElement('p')
    partial.setAttribute('data-observation-sensitive', '')
    Object.defineProperty(partial, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 180, 600, 60),
    })
    surface.append(scrolledAway, partial)
    document.body.append(surface)

    await observeApplicationSurface(
      { target: 'settings.storage', purpose: '确认存储路径' },
      new AbortController().signal
    )

    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      masks: [{ x: 0, y: 0, width: 600, height: 40 }],
    }))
  })

  it('指定的页面不可见时明确拒绝，不回退整窗或桌面', async () => {
    await expect(observeApplicationSurface(
      { target: 'workspace.canvas', purpose: '检查画布' },
      new AbortController().signal
    )).rejects.toThrow('SURFACE_NOT_VISIBLE')
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
