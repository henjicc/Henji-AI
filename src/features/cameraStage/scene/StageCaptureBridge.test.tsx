// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import StageCaptureBridge, { type StageCaptureFn } from './StageCaptureBridge'
import { attachCameraStageStore, createCameraStageStore } from '../store/cameraStageStore'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { sceneFromDocumentContent, sceneToDocumentContent } from '../domain/sceneSerialization'

const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined), gl: { domElement: { toDataURL: () => 'data:image/png;base64,test' } }, scene: {}, camera: {} }))
vi.mock('@/commands/documents', () => ({ saveDocumentCover: mocks.save }))
vi.mock('@react-three/fiber', () => ({ useThree: (select: (state: typeof mocks) => unknown) => select(mocks) }))
vi.mock('../render/stageStyleRenderer', () => ({ StageStyleRenderer: class {}, isStageStyleRenderStyle: () => false }))

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it.each([false, true])('封面写入由文档宿主授权（enabled=%s）', async (enabled) => {
  const store = createCameraStageStore({ coverRefresh: enabled })
  const snapshot = sceneFromDocumentContent(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot()))
  store.getState().loadSnapshot(snapshot, { id: 'cover-stage', name: '封面' })
  attachCameraStageStore(store)
  const captureRef = createRef<StageCaptureFn>()
  render(<StageCaptureBridge captureRef={captureRef} coverRefresh={store.coverRefresh} />)
  expect(captureRef.current).toBeTypeOf('function')
  await act(async () => { store.getState().seek(2); await vi.advanceTimersByTimeAsync(1_300) })
  await act(async () => { window.dispatchEvent(new Event('pagehide')) })
  if (enabled) expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ docId: 'cover-stage' }))
  else expect(mocks.save).not.toHaveBeenCalled()
})

it('旧文档桥尚未卸载时不能把画面写进新附着的渲染投影', async () => {
  const snapshot = sceneFromDocumentContent(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot()))
  const editor = createCameraStageStore({ coverRefresh: true })
  editor.getState().loadSnapshot(snapshot, { id: 'editor', name: '编辑器' })
  attachCameraStageStore(editor)
  render(<StageCaptureBridge captureRef={createRef<StageCaptureFn>()} coverRefresh={editor.coverRefresh} />)
  const projection = createCameraStageStore()
  projection.getState().loadSnapshot(snapshot, { id: 'projection', name: '渲染投影' })
  attachCameraStageStore(projection)
  await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(1_300) })
  expect(mocks.save).not.toHaveBeenCalled()
})

it('编辑器切换文档并提交后，封面订阅跟随新的文档实例', async () => {
  const snapshot = sceneFromDocumentContent(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot()))
  const first = createCameraStageStore({ coverRefresh: true })
  first.getState().loadSnapshot(snapshot, { id: 'first', name: '第一个文档' })
  attachCameraStageStore(first)
  const captureRef = createRef<StageCaptureFn>()
  const view = render(<StageCaptureBridge captureRef={captureRef} coverRefresh />)
  const second = createCameraStageStore({ coverRefresh: true })
  second.getState().loadSnapshot(snapshot, { id: 'second', name: '第二个文档' })
  attachCameraStageStore(second)
  view.rerender(<StageCaptureBridge captureRef={captureRef} coverRefresh />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ docId: 'second' }))
})
