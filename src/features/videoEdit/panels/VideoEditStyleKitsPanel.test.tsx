// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '../application/videoEditDocumentTestKit'
import { videoEditStyleKitLibrary } from '../application/videoEditStyleKitLibrary'
import { applyStyleKitToSequence } from '../application/videoEditStyleKits'
import { BUILTIN_STYLE_KITS, availableStyleKitFonts } from '@/core/videoEdit/styleKitPresets'
import { releaseVideoEditCodeCompiler } from '../application/videoEditCodeState'
import { undoVideoEdit } from '../application/videoEditService'
import { VideoEditStyleKitsPanel } from './VideoEditStyleKitsPanel'
import { VideoEditStyleKitPreview } from './VideoEditStyleKitPreview'
import { renderStyleKitPreview } from '../application/videoEditStylePreview'
vi.mock('../application/videoEditStylePreview', () => ({ renderStyleKitPreview: vi.fn(async () => new Blob(['preview'], { type: 'image/png' })) }))
vi.mock('../engine/videoEditCodeCompiler', async () => { const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler'); return { VideoEditCodeCompiler: class { async compile(source: string) { return compileCodeMaterial(source) } dispose() {} } } })
beforeEach(() => {
  installHarnessNativeStorage(); videoEditStyleKitLibrary.replace([])
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:preview-${Math.random()}`), revokeObjectURL: vi.fn() }))
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('令牌修改保持候选，应用一次撤销；从作品提取不覆盖，偏好写规则，另存跨工程库', async () => {
  const instance = await createVideoEditTestProject(); const kit = applyStyleKitToSequence(instance.document.id, instance.activeSequenceId, availableStyleKitFonts(BUILTIN_STYLE_KITS[0], [])); const error = vi.fn()
  const view = render(<VideoEditStyleKitsPanel instance={instance} onError={error} visible={false} />)
  const history = instance.past.length
  fireEvent.change(screen.getByRole('textbox', { name: '风格名称' }), { target: { value: '个人风格' } })
  expect(instance.document.styleKits![0].name).toBe(kit.name); expect(instance.past).toHaveLength(history)
  fireEvent.click(screen.getByRole('button', { name: '应用到序列' }))
  await waitFor(() => expect(instance.document.styleKits![0].name).toBe('个人风格'))
  expect(instance.past).toHaveLength(history + 1)
  undoVideoEdit(instance.document.id); expect(instance.document.styleKits![0]).toEqual(kit)
  view.rerender(<VideoEditStyleKitsPanel instance={instance} onError={error} visible={false} />)
  fireEvent.click(screen.getByRole('button', { name: '从当前作品提取' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '风格名称' })).toHaveProperty('value', '作品风格'))
  expect(instance.document.styleKits![0]).toEqual(kit)
  fireEvent.click(screen.getByRole('button', { name: '另存到风格库' }))
  await waitFor(() => expect(videoEditStyleKitLibrary.custom()).toHaveLength(1))
  fireEvent.change(screen.getByRole('textbox', { name: '长期风格偏好' }), { target: { value: '标题不用衬线体' } })
  fireEvent.click(screen.getByRole('button', { name: '记住偏好' }))
  await waitFor(() => expect(instance.document.styleKits![0].rules).toContain('标题不用衬线体'))
  expect(screen.queryByRole('textbox', { name: '风格规则' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '编辑规则' })); expect(screen.getByRole('textbox', { name: '风格规则' })).toBeTruthy()
  expect(error).not.toHaveBeenCalled()
})
it('隐藏/卸载预览取消任务并释放图片，迟到结果不能覆盖新候选', async () => {
  const kit = availableStyleKitFonts(BUILTIN_STYLE_KITS[0], [])
  let finish!: (value: Blob) => void
  vi.mocked(renderStyleKitPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<VideoEditStyleKitPreview kit={kit} width={1920} height={1080} />)
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  view.rerender(<VideoEditStyleKitPreview kit={kit} width={1920} height={1080} visible={false} />)
  finish(new Blob(['late']))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.queryByRole('img')).toBeNull()
  view.rerender(<VideoEditStyleKitPreview kit={{ ...kit, name: '新候选' }} width={1920} height={1080} />)
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
  view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
})
