/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useNavigationStore } from '@/stores/navigationStore'

import { getHostScopeRevisions, retainHostContextTracking } from './hostContext'
import { notifyApplicationDomainChanged } from '@/core/application-control/domainChangeSignal'

/**
 * `toolbox` 这个 scope 同时被三维场景写入当成乐观并发基线（`baseRevision`）。
 *
 * 因此它只能由**数据变化**推进。实测踩过的坑：打开 3D 编辑器会改 `activeToolId`，
 * 当时这也推进 toolbox，而系统提示词要求可视编辑任务先打开 Surface 再写入——于是模型
 * 拿着打开前读到的 baseRevision 发起第一次写入，必然 CONFLICT，没有任何办法绕开。
 */
describe('宿主作用域 revision', () => {
  let release: (() => void) | undefined

  beforeEach(() => {
    release = retainHostContextTracking()
  })

  afterEach(() => {
    release?.()
    release = undefined
    useNavigationStore.setState({ activeToolId: null })
  })

  it('切换工具箱工具只推进 navigation，不推进 toolbox', () => {
    const before = getHostScopeRevisions()
    useNavigationStore.setState({ activeToolId: 'cameraStage' })
    const after = getHostScopeRevisions()

    expect(after.toolbox).toBe(before.toolbox)
    expect(after.navigation).toBeGreaterThan(before.navigation)
  })

  it('关闭工具箱工具同样不推进 toolbox', () => {
    useNavigationStore.setState({ activeToolId: 'cameraStage' })
    const before = getHostScopeRevisions()
    useNavigationStore.setState({ activeToolId: null })

    expect(getHostScopeRevisions().toolbox).toBe(before.toolbox)
  })

  it('画布选中与素材库开合不推进各自的数据作用域', () => {
    const before = getHostScopeRevisions()
    useCanvasStore.setState({ selectedNodeId: 'node-1' })
    useAssetLibraryStore.setState({ view: 'floating' })
    const after = getHostScopeRevisions()

    expect(after.canvas).toBe(before.canvas)
    expect(after.assets).toBe(before.assets)
    expect(after.surface).toBeGreaterThan(before.surface)
  })

  it('正式素材写入信号推进 assets，而素材库纯界面状态仍不推进', () => {
    const before = getHostScopeRevisions()
    notifyApplicationDomainChanged('assets')
    expect(getHostScopeRevisions().assets).toBe(before.assets + 1)
  })

  it('画布节点数据变化仍然推进 canvas', () => {
    const before = getHostScopeRevisions()
    useCanvasStore.setState({ nodes: [] })

    expect(getHostScopeRevisions().canvas).toBeGreaterThan(before.canvas)
  })

  it('三维场景数据变化仍然推进 toolbox', () => {
    const before = getHostScopeRevisions()
    useCameraStageStore.setState({ objects: [] })

    // 这条守的是"别把上一条修过头"：数据变化必须继续推进基线，否则乐观并发就失效了。
    expect(getHostScopeRevisions().toolbox).toBeGreaterThan(before.toolbox)
  })
})
