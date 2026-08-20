import { beforeEach, describe, expect, it } from 'vitest'
import { useAssetLibraryStore } from './assetLibraryStore'

describe('assetLibraryStore', () => {
  beforeEach(() => useAssetLibraryStore.setState({ view: 'closed', sourceWorkspace: 'generation', libraryId: null, keyword: '', mediaType: null, sort: 'created', selectedAsset: null, batchMode: false, batchSelectedIds: [] }))

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

  it('批量模式去重选择并在退出时清空临时状态', () => {
    const store = useAssetLibraryStore.getState()
    store.enterBatchMode(['a', 'a'])
    store.toggleBatchAsset('b')
    store.toggleBatchAsset('a')

    expect(useAssetLibraryStore.getState()).toMatchObject({ batchMode: true, batchSelectedIds: ['b'] })

    useAssetLibraryStore.getState().exitBatchMode()
    expect(useAssetLibraryStore.getState()).toMatchObject({ batchMode: false, batchSelectedIds: [] })
  })
})
