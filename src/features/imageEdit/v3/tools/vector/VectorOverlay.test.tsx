/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ToolOverlayContext } from '../../toolFramework/types'
import { useImageEditorSessionStoreV3 } from '../../store'
import { VectorOverlay } from './VectorOverlay'
import { addImageEditVectorLayersV3 } from './service'

vi.mock('./service', () => ({ addImageEditVectorLayersV3: vi.fn() }))
function mount(): ReturnType<typeof render> {
  const document = createImageEditDocumentV3({ width: 400, height: 300, documentId: 'ime' })
  const controller = { document, sessionId: 'ime' }
  const context = { controller, geometry: { width: 400, height: 300, sourceToOutput: [1, 0, 0, 1, 0, 0] }, bindKeyboard: () => () => undefined } as unknown as ToolOverlayContext
  return render(<VectorOverlay {...context} />)
}
beforeEach(() => {
  vi.clearAllMocks(); useImageEditorSessionStoreV3.setState({ sessions: {} })
  useImageEditorSessionStoreV3.getState().ensureSession('ime', ['vector-text', 'move'])
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x:0, y:0, left:0, top:0, width:400, height:300, right:400, bottom:300, toJSON:()=>({}) })
  vi.stubGlobal('PointerEvent', MouseEvent)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('中文输入法候选 Enter 不提交，确认后仅生成一次正式文字图层', () => {
  const result = mount(), overlay = result.container.querySelector('[data-vector-overlay]')!
  fireEvent.pointerDown(overlay, {button:0,clientX:100,clientY:120})
  const input = screen.getByRole('textbox', { name:'文字内容' })
  fireEvent.compositionStart(input); fireEvent.change(input, { target:{value:'中文标题'} })
  fireEvent.keyDown(input, { key:'Enter',isComposing:true })
  expect(addImageEditVectorLayersV3).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input); fireEvent.keyDown(input,{key:'Enter'})
  expect(addImageEditVectorLayersV3).toHaveBeenCalledTimes(1)
  expect(vi.mocked(addImageEditVectorLayersV3).mock.calls[0][1][0]).toMatchObject({type:'text',content:{paragraphs:[{runs:[{text:'中文标题'}]}]}})
})
it('取消、切换工具和编辑期间文档更新不提交草稿', () => {
  const result = mount(), overlay = result.container.querySelector('[data-vector-overlay]')!
  fireEvent.pointerDown(overlay,{button:0,clientX:20,clientY:20})
  fireEvent.change(screen.getByRole('textbox',{name:'文字内容'}),{target:{value:'未确认'}})
  fireEvent.keyDown(screen.getByRole('textbox',{name:'文字内容'}),{key:'Escape'})
  expect(screen.queryByRole('textbox',{name:'文字内容'})).toBeNull()
  fireEvent.pointerDown(overlay,{button:0,clientX:20,clientY:20})
  act(()=>useImageEditorSessionStoreV3.getState().setActiveTool('ime','move'))
  expect(screen.queryByRole('textbox',{name:'文字内容'})).toBeNull()
  expect(addImageEditVectorLayersV3).not.toHaveBeenCalled()
})
it('连续输入只更新本地草稿，IME 确认不写历史，正式确认只提交一次', () => {
  const result = mount(), overlay = result.container.querySelector('[data-vector-overlay]')!
  fireEvent.pointerDown(overlay, { button: 0, clientX: 100, clientY: 120 })
  const input = screen.getByRole('textbox', { name: '文字内容' })
  for (const value of ['连续', '连续文字', '连续文字输入']) fireEvent.change(input, { target: { value } })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '连续文字输入确认' } })
  fireEvent.compositionEnd(input)
  expect(addImageEditVectorLayersV3).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }))
  expect(addImageEditVectorLayersV3).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('textbox', { name: '文字内容' })).toBeNull()
})
