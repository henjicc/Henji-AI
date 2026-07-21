import { beforeEach, describe, expect, it } from 'vitest'
import { useAssetLibraryStore } from './assetLibraryStore'

describe('assetLibraryStore', () => {
  beforeEach(() => useAssetLibraryStore.setState({ view: 'closed', sourceWorkspace: 'generation', libraryId: null, keyword: '', mediaType: null, sort: 'created', selectedAsset: null }))

  it('在不切换来源工作区时打开和关闭悬浮面板', () => {
    useAssetLibraryStore.getState().setSourceWorkspace('nodes')
    useAssetLibraryStore.getState().openFloating()
    expect(useAssetLibraryStore.getState()).toMatchObject({ view: 'floating', sourceWorkspace: 'nodes' })
    useAssetLibraryStore.getState().close()
    expect(useAssetLibraryStore.getState()).toMatchObject({ view: 'closed', sourceWorkspace: 'nodes' })
  })

  it('在悬浮与完整工作区之间保持共享筛选状态', () => {
    const store = useAssetLibraryStore.getState()
    store.setKeyword('角色')
    store.setMediaType('image')
    store.setLibraryId('characters')
    store.setView('workspace')
    expect(useAssetLibraryStore.getState()).toMatchObject({ view: 'workspace', keyword: '角色', mediaType: 'image', libraryId: 'characters' })
  })
})
