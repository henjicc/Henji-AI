import { beforeEach, describe, expect, it } from 'vitest'

import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'

import {
  closeAssetLibrary,
  openAssetLibrary,
  selectToolboxTool,
  switchWorkspace,
  useNavigationStore,
} from './navigationStore'

describe('navigationStore', () => {
  beforeEach(() => {
    useNavigationStore.setState({
      activeWorkspace: 'generation',
      activeToolId: null,
      revision: 0,
    })
    useAssetLibraryStore.setState({
      view: 'closed',
      sourceWorkspace: 'generation',
      batchMode: false,
      batchSelectedIds: [],
    })
  })

  it('切换普通工作区时关闭素材库并递增 revision', () => {
    useAssetLibraryStore.getState().setView('floating')

    switchWorkspace('nodes')

    expect(useNavigationStore.getState()).toMatchObject({
      activeWorkspace: 'nodes',
      revision: 1,
    })
    expect(useAssetLibraryStore.getState().view).toBe('closed')
  })

  it('打开完整素材库并在关闭后返回来源工作区', () => {
    switchWorkspace('nodes')
    openAssetLibrary('workspace')

    expect(useNavigationStore.getState().activeWorkspace).toBe('assets')
    expect(useAssetLibraryStore.getState()).toMatchObject({
      view: 'workspace',
      sourceWorkspace: 'nodes',
    })

    closeAssetLibrary()

    expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
    expect(useAssetLibraryStore.getState().view).toBe('closed')
  })

  it('悬浮素材库不切换当前工作区', () => {
    switchWorkspace('tools')

    openAssetLibrary('floating')

    expect(useNavigationStore.getState().activeWorkspace).toBe('tools')
    expect(useAssetLibraryStore.getState()).toMatchObject({
      view: 'floating',
      sourceWorkspace: 'tools',
    })
  })

  it('完整素材库切回悬浮态时恢复来源工作区作为背景', () => {
    switchWorkspace('nodes')
    openAssetLibrary('workspace')

    openAssetLibrary('floating')

    expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
    expect(useAssetLibraryStore.getState()).toMatchObject({
      view: 'floating',
      sourceWorkspace: 'nodes',
    })
  })

  it('工具箱子工具与工作区共享导航 revision', () => {
    selectToolboxTool('cameraStage')

    expect(useNavigationStore.getState()).toMatchObject({
      activeToolId: 'cameraStage',
      revision: 1,
    })
  })
})
