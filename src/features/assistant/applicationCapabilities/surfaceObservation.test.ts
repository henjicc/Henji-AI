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

  it('Surface 不可见时拒绝降级为整窗或桌面截图', async () => {
    await expect(observeApplicationSurface(
      { surfaceId: 'workspace.canvas', purpose: '检查画布' },
      new AbortController().signal
    )).rejects.toThrow('SURFACE_NOT_VISIBLE')
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
