import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assetService: {
    query: vi.fn(), read: vi.fn(), listLibraries: vi.fn(), listTags: vi.fn(),
    select: vi.fn(), replaceTags: vi.fn(), addToLibrary: vi.fn(),
    removeFromLibrary: vi.fn(), delete: vi.fn(),
  },
  notifyHostScopeChanged: vi.fn(),
  configuredDependencies: null as null | { readRevision: () => number; bumpRevision: () => void },
}))

vi.mock('@/features/assets/application/assetApplicationService', () => ({
  assetApplicationService: mocks.assetService,
}))
vi.mock('@/features/application-control/hostContext/hostContext', () => ({
  getHostScopeRevisions: () => ({ assets: 7 }),
  notifyHostScopeChanged: mocks.notifyHostScopeChanged,
}))
vi.mock('@/features/assets/application/assetControlDependencies', () => ({
  configureAssetMutationDependencies: (dependencies: typeof mocks.configuredDependencies) => {
    mocks.configuredDependencies = dependencies
  },
}))

import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { registerAssetCapabilityHandlers } from '@/features/assets/application/registerAssetCapabilityHandlers'

const context = { signal: new AbortController().signal }

function registeredHandlers(): Map<string, CapabilityHandler> {
  const handlers = new Map<string, CapabilityHandler>()
  registerAssetCapabilityHandlers({ registerHandler: (id, handler) => handlers.set(id, handler) })
  return handlers
}

describe('asset capability handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configuredDependencies = null
    mocks.assetService.select.mockResolvedValue({ assetId: 'asset-1' })
  })

  it('素材写入执行器拿到的依赖读宿主 revision，自己不推进：推进只在素材命令边界发生一次', () => {
    registeredHandlers()

    mocks.configuredDependencies?.bumpRevision()

    expect(mocks.notifyHostScopeChanged).not.toHaveBeenCalled()
    expect(mocks.configuredDependencies?.readRevision()).toBe(7)
  })

  it('选择素材只改变界面选中项，不推进素材数据 revision', async () => {
    const handlers = registeredHandlers()

    await handlers.get('select_asset')?.({ assetId: 'asset-1' }, context)

    expect(mocks.assetService.select).toHaveBeenCalledWith('asset-1')
    expect(mocks.notifyHostScopeChanged).not.toHaveBeenCalled()
  })
})
