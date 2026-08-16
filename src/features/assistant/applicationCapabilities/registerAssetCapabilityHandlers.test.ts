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
vi.mock('../hostContext/hostContext', () => ({
  getHostScopeRevisions: () => ({ assets: 7 }),
  notifyHostScopeChanged: mocks.notifyHostScopeChanged,
}))
vi.mock('./applicationControlRegistry', () => ({
  configureAssetMutationDependencies: (dependencies: typeof mocks.configuredDependencies) => {
    mocks.configuredDependencies = dependencies
  },
}))

import type { CapabilityHandler } from './handlerTypes'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'

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
    mocks.assetService.replaceTags.mockResolvedValue({ assetId: 'asset-1', tags: ['精选'] })
  })

  it('正式写入只由素材命令边界推进一次 revision，handler 与 executor 不重复 bump', async () => {
    const handlers = registeredHandlers()

    await handlers.get('set_asset_tags')?.({ assetId: 'asset-1', tags: ['精选'] }, context)
    mocks.configuredDependencies?.bumpRevision()

    expect(mocks.assetService.replaceTags).toHaveBeenCalledTimes(1)
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
