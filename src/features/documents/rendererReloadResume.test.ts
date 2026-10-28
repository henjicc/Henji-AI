// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { DocumentKindDescriptor } from '@/core/documents/kinds'

const state = vi.hoisted(() => ({
  openDocument: vi.fn(), findDocument: vi.fn(), setActiveWorkspace: vi.fn(),
  current: undefined as string | undefined, workspace: 'home', operations: null as null | import('./documentOperations').DocumentOperations,
}))
vi.mock('./documentOperations', async (original) => {
  const actual = await original<typeof import('./documentOperations')>()
  return { ...actual, getDocumentOperations: () => ({ openDocument: state.openDocument, findDocument: state.findDocument, whenOpenable: (kind: never) => state.operations!.whenOpenable(kind) }) }
})
vi.mock('./currentDocumentContext', () => ({ currentDocumentContext: () => ({ documentId: state.current }) }))
vi.mock('./documentSessionRegistry', () => ({ getDocumentSessionRegistry: () => ({ get: (id: string) => (id === state.current ? {} : undefined) }) }))
vi.mock('@/stores/navigationStore', () => ({ useNavigationStore: { getState: () => ({ activeWorkspace: state.workspace, setActiveWorkspace: state.setActiveWorkspace }) } }))

const KEY = 'henji.rendererReloadResume'
const saved = { workspace: 'videoEdit', documents: { videoEdit: 'cut' }, focusedDocumentId: 'cut', views: { cut: { sequenceId: 'main', frame: 120 } } }

beforeEach(async () => {
  vi.useFakeTimers()
  const { DocumentOperations } = await import('./documentOperations')
  state.operations = new DocumentOperations({ kinds: { require: () => ({}) as DocumentKindDescriptor } })
  state.findDocument.mockResolvedValue({ id: 'cut', kind: 'video_edit' })
})
afterEach(() => { vi.useRealTimers(); window.history.replaceState(null, '', '/'); sessionStorage.clear(); state.current = undefined; state.workspace = 'home'; vi.clearAllMocks(); vi.resetModules() })

it.each([
  ['', true],
  ['?henjiRecovery=safe', false],
])('重新加载后回到原文档与剪辑视图；崩溃后的安全恢复（%s）什么都不恢复', async (search, resumes) => {
  window.history.replaceState(null, '', `/${search}`)
  // 安全恢复的结果按页面记一次，每个用例换一份新模块。
  const { installRendererReloadResume } = await import('./rendererReloadResume')
  const { registerReloadResumeView } = await import('@/core/documents/reloadResumeViews')
  const restore = vi.fn()
  registerReloadResumeView('video_edit', { capture: () => ({}), restore })
  state.operations!.registerOpener('video_edit', () => {})
  sessionStorage.setItem(KEY, JSON.stringify(saved))
  installRendererReloadResume()
  await vi.waitFor(() => { if (resumes) expect(restore).toHaveBeenCalled() })
  expect(state.setActiveWorkspace).toHaveBeenCalledTimes(resumes ? 1 : 0)
  expect(state.openDocument).toHaveBeenCalledTimes(resumes ? 1 : 0)
  if (resumes) expect(restore).toHaveBeenCalledWith('cut', { sequenceId: 'main', frame: 120 })
  else expect(restore).not.toHaveBeenCalled()
})

it('打开方式晚于恢复时机登记也能回去；恢复做完之前不拿半途的状态覆盖记下的位置', async () => {
  const { installRendererReloadResume } = await import('./rendererReloadResume')
  const { registerReloadResumeView } = await import('@/core/documents/reloadResumeViews')
  const restore = vi.fn()
  registerReloadResumeView('video_edit', { capture: () => ({ cut: { sequenceId: 'main', frame: 7 } }), restore })
  sessionStorage.setItem(KEY, JSON.stringify(saved))
  installRendererReloadResume()
  // 工作区很久之后才载入：超过以前 10 秒的重试上限
  await vi.advanceTimersByTimeAsync(20_000)
  expect(state.openDocument).not.toHaveBeenCalled()
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual(saved)
  state.operations!.registerOpener('video_edit', () => {})
  await vi.waitFor(() => expect(restore).toHaveBeenCalledWith('cut', saved.views.cut))
  // 恢复做完后照常记录当前位置
  state.current = 'cut'; state.workspace = 'videoEdit'
  await vi.advanceTimersByTimeAsync(1_000)
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ workspace: 'videoEdit', documents: { videoEdit: 'cut' }, focusedDocumentId: 'cut', views: { cut: { sequenceId: 'main', frame: 7 } } })
})

it.each([
  ['切了工作区', () => { state.workspace = 'nodes' }],
  ['打开了别的文档', () => { state.current = 'other' }],
])('等待期间用户%s：不再打开记下的文档，照常开始记录', async (_name, act) => {
  const { installRendererReloadResume } = await import('./rendererReloadResume')
  sessionStorage.setItem(KEY, JSON.stringify(saved))
  installRendererReloadResume()
  await vi.advanceTimersByTimeAsync(2_000)
  act()
  state.operations!.registerOpener('video_edit', () => {})
  await vi.advanceTimersByTimeAsync(1_000)
  expect(state.openDocument).not.toHaveBeenCalled()
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ workspace: state.workspace, focusedDocumentId: state.current ?? null })
})

it('应用宿主一直没载入：等到上限放弃恢复，照常开始记录', async () => {
  const { installRendererReloadResume } = await import('./rendererReloadResume')
  sessionStorage.setItem(KEY, JSON.stringify(saved))
  installRendererReloadResume()
  await vi.advanceTimersByTimeAsync(29_000)
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual(saved)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(state.openDocument).not.toHaveBeenCalled()
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ workspace: 'home', focusedDocumentId: null })
})

it('安全恢复参数读一次就从地址去掉，本页之后仍按安全恢复判断，其他参数保留', async () => {
  window.history.replaceState(null, '', '/?henjiDevSkipOnboarding=1&henjiRecovery=safe#home')
  const { isSafeRendererRecovery } = await import('@/core/applicationLifecycle/rendererRecovery')
  expect(isSafeRendererRecovery()).toBe(true)
  expect(window.location.search).toBe('?henjiDevSkipOnboarding=1')
  expect(window.location.hash).toBe('#home')
  expect(isSafeRendererRecovery()).toBe(true)
})
