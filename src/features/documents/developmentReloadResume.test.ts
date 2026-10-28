// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ openDocument: vi.fn(), findDocument: vi.fn(), setActiveWorkspace: vi.fn() }))
vi.mock('./documentOperations', () => ({ getDocumentOperations: () => ({ openDocument: state.openDocument, findDocument: state.findDocument }) }))
vi.mock('./currentDocumentContext', () => ({ currentDocumentContext: () => ({ documentId: null }) }))
vi.mock('@/stores/navigationStore', () => ({ useNavigationStore: { getState: () => ({ activeWorkspace: 'canvas', setActiveWorkspace: state.setActiveWorkspace }) } }))

const hot = () => ({ on: vi.fn() }) as unknown as NonNullable<ImportMeta['hot']>

afterEach(() => { window.history.replaceState(null, '', '/'); sessionStorage.clear(); vi.clearAllMocks(); vi.resetModules() })

it.each([
  ['', true],
  ['?henjiRecovery=safe', false],
])('重新加载后回到原文档；崩溃后的安全恢复（%s）不回去', async (search, resumes) => {
  window.history.replaceState(null, '', `/${search}`)
  // 安全恢复的结果按页面记一次，每个用例换一份新模块。
  const { installDevelopmentReloadResume } = await import('./developmentReloadResume')
  sessionStorage.setItem('henji.development.reloadResume', JSON.stringify({ workspace: 'videoEdit', documentId: 'document' }))
  state.findDocument.mockResolvedValue({ id: 'document' })
  installDevelopmentReloadResume(hot())
  await vi.waitFor(() => { if (resumes) expect(state.openDocument).toHaveBeenCalled() })
  expect(state.setActiveWorkspace).toHaveBeenCalledTimes(resumes ? 1 : 0)
  expect(state.openDocument).toHaveBeenCalledTimes(resumes ? 1 : 0)
  expect(sessionStorage.getItem('henji.development.reloadResume')).toBeNull()
})

it('安全恢复参数读一次就从地址去掉，本页之后仍按安全恢复判断，其他参数保留', async () => {
  window.history.replaceState(null, '', '/?henjiDevSkipOnboarding=1&henjiRecovery=safe#home')
  const { isSafeRendererRecovery } = await import('@/core/applicationLifecycle/rendererRecovery')
  expect(isSafeRendererRecovery()).toBe(true)
  expect(window.location.search).toBe('?henjiDevSkipOnboarding=1')
  expect(window.location.hash).toBe('#home')
  expect(isSafeRendererRecovery()).toBe(true)
})
