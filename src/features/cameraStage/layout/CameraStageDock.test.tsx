// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import CameraStageDock from './CameraStageDock'
import { cameraStageLayoutPresets, defaultCameraStageLayout } from './dockLayout'

const lifetime = vi.hoisted(() => ({ mounts: 0, releases: 0 }))
vi.mock('../viewport/StageViewportWorkspace', async () => {
  const { useEffect } = await import('react')
  return { default: function Viewport(): JSX.Element {
    useEffect(() => { lifetime.mounts++; return () => { lifetime.releases++ } }, [])
    return <canvas data-testid="viewport" />
  } }
})
vi.mock('../panels/ObjectListPanel', () => ({ default: () => <div>场景对象</div> }))
vi.mock('../panels/PropertyPanel', () => ({ default: () => <div>属性</div> }))
vi.mock('../stateKeyframes/StateKeyframeTimelinePanel', () => ({ default: () => <div>状态关键帧</div> }))

beforeEach(async () => {
  installHarnessNativeStorage()
  await cameraStageLayoutPresets.load()
  await cameraStageLayoutPresets.restore({ activeId: 'default', current: defaultCameraStageLayout(), users: [] })
  lifetime.mounts = 0; lifetime.releases = 0
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 860))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('共享预设切换、重置与另存恢复保持同一个视口 canvas 和挂载实例', async () => {
  const view = render(<CameraStageDock captureRef={{ current: null }} />)
  const canvas = view.getByTestId('viewport')
  let saved = ''
  await act(async () => { saved = await cameraStageLayoutPresets.saveAs('我的布局') })
  for (const id of ['viewport', 'default', saved]) {
    await act(async () => { await cameraStageLayoutPresets.apply(id); await cameraStageLayoutPresets.resetActive() })
    expect(view.getByTestId('viewport')).toBe(canvas)
    expect(lifetime).toEqual({ mounts: 1, releases: 0 })
  }
  view.unmount()
  expect(lifetime).toEqual({ mounts: 1, releases: 1 })
})
