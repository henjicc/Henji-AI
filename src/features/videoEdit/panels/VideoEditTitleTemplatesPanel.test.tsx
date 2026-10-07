import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { undoVideoEdit } from '../application/videoEditService'
import { closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { useTitleTemplateLibrary } from '../application/videoEditTitleTemplateLibrary'
import { VideoEditTitleTemplatesPanel } from './VideoEditTitleTemplatesPanel'

beforeEach(() => { installHarnessNativeStorage(); useTitleTemplateLibrary.setState({ templates: [], error: '' }); vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } }) })
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('基本图形浏览/双击应用与参数编辑/另存组合共用一步撤销，搜索仍可选择', async () => {
  const instance = await createVideoEditProject(); const onError = vi.fn()
  const view = render(<VideoEditTitleTemplatesPanel instance={instance} onError={onError} />)
  fireEvent.doubleClick(screen.getByRole('button', { name: '下三分之一人名条' }))
  expect(instance.document.sequences[0].clips).toHaveLength(1)
  view.rerender(<VideoEditTitleTemplatesPanel instance={instance} onError={onError} />)
  const history = instance.past.length
  fireEvent.change(screen.getByRole('textbox', { name: '标题文字' }), { target: { value: '王五' } })
  fireEvent.click(screen.getByRole('button', { name: '修改所选标题' }))
  expect(instance.document.sequences[0].clips[0].graphic?.objects.find(object => object.kind === 'text')?.parameters.text).toBe('王五')
  expect(instance.past).toHaveLength(history + 1)
  undoVideoEdit(instance.document.id)
  view.rerender(<VideoEditTitleTemplatesPanel instance={instance} onError={onError} />)
  fireEvent.click(screen.getByRole('button', { name: '保存所选文字 / 图形组合' }))
  expect(useTitleTemplateLibrary.getState().templates).toHaveLength(1)
  fireEvent.change(screen.getByRole('textbox', { name: '搜索标题模板' }), { target: { value: '章节' } })
  expect(screen.getByRole('button', { name: '章节标题' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '下三分之一人名条' })).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})
