// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { videoEditStyleKitLibrary } from '../application/videoEditStyleKitLibrary'
import { applyStyleKitToSequence, copyStyleKit } from '../application/videoEditStyleKits'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { styleGuideSection } from '@/core/videoEdit/styleKit'
import { releaseVideoEditCodeCompiler } from '../application/videoEditCodeState'
import { undoVideoEdit } from '../application/videoEditService'
import { VideoEditStyleKitsPanel } from './VideoEditStyleKitsPanel'
vi.mock('../engine/videoEditCodeCompiler', async () => {
 const { testAuthorBundle } = await import('../engine/videoEditAuthorTestFixtures')
 return { VideoEditCodeCompiler: class { async bundleQueued(files: import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles) { return testAuthorBundle(files) } dispose() {} } }
})
vi.mock('../application/videoEditAuthorInspection', async () => {
 const { testAuthorProgram } = await import('../engine/videoEditAuthorTestFixtures')
 return { inspectVideoEditAuthor: async (bundle: import('@/core/videoEdit/codeAuthorProgram').CodeAuthorBundle) => testAuthorProgram(bundle) }
})
beforeEach(() => {
  installHarnessNativeStorage(); videoEditStyleKitLibrary.replace([])
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } })
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('按章节编辑说明书是候选，绑定一次撤销；缺必填章节被点名拒绝；另存跨工程库；示例可删除', async () => {
  const instance = await createVideoEditTestProject(); const kit = applyStyleKitToSequence(instance.document.id, instance.activeSequenceId, copyStyleKit({ ...BUILTIN_STYLE_KITS[0], examples: [{ id: 'test', title: '测试参考', note: '', source: 'export default {name:"测试",draw(){}}' }] })); const error = vi.fn()
  const view = render(<VideoEditStyleKitsPanel instance={instance} onError={error} visible={false} />)
  const history = instance.past.length
  // Every fixed section has its own editor, prefilled from the bound guide.
  expect((screen.getByRole('textbox', { name: '说明书：定位' }) as HTMLTextAreaElement).value).toBe(styleGuideSection(kit.guide, '定位'))
  fireEvent.change(screen.getByRole('textbox', { name: '风格名称' }), { target: { value: '个人风格' } })
  fireEvent.change(screen.getByRole('textbox', { name: '说明书：避免' }), { target: { value: '- 标题用衬线体' } })
  expect(instance.document.styleKits![0]).toEqual(kit); expect(instance.past).toHaveLength(history)
  fireEvent.click(screen.getByRole('button', { name: '绑定到序列' }))
  await waitFor(() => expect(instance.document.styleKits![0].name).toBe('个人风格'))
  expect(styleGuideSection(instance.document.styleKits![0].guide, '避免')).toBe('- 标题用衬线体')
  expect(instance.past).toHaveLength(history + 1)
  undoVideoEdit(instance.document.id); expect(instance.document.styleKits![0]).toEqual(kit)
  view.rerender(<VideoEditStyleKitsPanel instance={instance} onError={error} visible={false} />)
  fireEvent.change(screen.getByRole('textbox', { name: '说明书：必须' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '绑定到序列' }))
  await waitFor(() => expect(screen.getByText('说明书“必须”还没有写。')).toBeTruthy())
  expect(instance.document.styleKits![0]).toEqual(kit)
  fireEvent.change(screen.getByRole('textbox', { name: '说明书：必须' }), { target: { value: '- 一个画面一个焦点' } })
  fireEvent.click(screen.getByRole('button', { name: `删除示例“${kit.examples[0].title}”` }))
  fireEvent.click(screen.getByRole('button', { name: '另存到风格库' }))
  await waitFor(() => expect(videoEditStyleKitLibrary.custom()).toHaveLength(1))
  expect(videoEditStyleKitLibrary.custom()[0].examples).toHaveLength(kit.examples.length - 1)
  expect(screen.getByRole('button', { name: '把所选代码片段加为示例' }).getAttribute('aria-disabled')).toBe('true')
  // The only reported failure is the deliberate incomplete-guide check above.
  expect(error).toHaveBeenCalledTimes(1)
}, 20_000)
it('让助手按说明书写示例带上未保存的全文并直接发送；起草说明书只预填等用户补充', async () => {
  const { useAssistantUiStore } = await import('@/features/assistant/store/assistantUiStore')
  const instance = await createVideoEditTestProject(); applyStyleKitToSequence(instance.document.id, instance.activeSequenceId, copyStyleKit(BUILTIN_STYLE_KITS[0]))
  render(<VideoEditStyleKitsPanel instance={instance} onError={vi.fn()} visible={false} />)
  fireEvent.change(screen.getByRole('textbox', { name: '说明书：避免' }), { target: { value: '- 未保存的新规矩' } })
  fireEvent.click(screen.getByRole('button', { name: '让助手按说明书写一段' }))
  await waitFor(() => expect(useAssistantUiStore.getState().pendingGoal).toContain('自定义风格'))
  expect(useAssistantUiStore.getState().pendingGoalOptions).toMatchObject({ autoSend: true })
  expect(useAssistantUiStore.getState().pendingGoalOptions?.context).toContain('- 未保存的新规矩')
  fireEvent.click(screen.getByRole('button', { name: '让助手起草' }))
  await waitFor(() => expect(useAssistantUiStore.getState().pendingGoal).toMatch(/^参考我给的素材/))
  expect(useAssistantUiStore.getState().pendingGoalOptions?.autoSend).toBeFalsy()
  expect(screen.getByRole('textbox', { name: '说明书：定位' }).className).toContain('ui-textarea-fit')
}, 20_000)

vi.mock('../application/videoEditCodeService', async importOriginal => ({ ...(await importOriginal<typeof import('../application/videoEditCodeService')>()), trialVideoEditAuthorSource: async () => undefined }))
