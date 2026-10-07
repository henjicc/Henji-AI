// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { VirtuosoMockContext } from 'react-virtuoso'
import { GENERIC_FONT_FACES, type FontFaceInfo } from '@/core/fonts/catalog'
import { UiFontPicker } from './UiFontPicker'
import { loadFontLibrary, fontLibrarySnapshot } from '@/platform/fonts'

const boundary = vi.hoisted(() => ({ faces: [] as FontFaceInfo[], saved: vi.fn(), read: vi.fn(), imported: vi.fn(), removed: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({
  fonts: { list: async () => ({ faces: boundary.faces, revision: 1 }), onChanged: () => () => undefined, readFace: boundary.read, importFiles: boundary.imported, remove: boundary.removed },
  settings: { get: async () => null, set: boundary.saved },
}) }))
beforeAll(async () => {
  boundary.faces = [
    { ...GENERIC_FONT_FACES[0], id: 'regular', family: 'Source Han Sans', fullName: 'Source Han Sans Regular', localizedFamily: '思源黑体', postscriptName: 'SourceHanSans-Regular', aliases: [] },
    { ...GENERIC_FONT_FACES[0], id: 'bold', family: 'Source Han Sans', fullName: 'Source Han Sans Bold', localizedFamily: '思源黑体', style: 'Bold', weight: 700, aliases: [] },
    { ...GENERIC_FONT_FACES[1], id: 'imported', family: 'Imported Serif', fullName: 'Imported Serif', localizedFamily: 'Imported Serif', imported: true, supportsCjk: false, aliases: [] },
    ...Array.from({ length: 1000 }, (_, i) => ({ ...GENERIC_FONT_FACES[2], id: `many-${i}`, family: `Test ${i}`, localizedFamily: `Test ${i}`, fullName: `Test ${i}`, supportsCjk: false })),
  ]
  boundary.read.mockImplementation(async (id: string) => ({ face: boundary.faces.find(face => face.id === id), bytes: new Uint8Array([1]) }))
  await loadFontLibrary()
})
afterEach(cleanup)
function picker(onSelect = vi.fn(), onPreview = vi.fn(), value = 'sans-serif') {
  return { onSelect, onPreview, ...render(<VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 36 }}><UiFontPicker value={value} onSelect={onSelect} onPreview={onPreview} projectFonts={['Source Han Sans']} /></VirtuosoMockContext.Provider>) }
}
it('中英文即时搜索，悬停临时预览、离开恢复，键盘选中才提交', async () => {
  const view = picker(); fireEvent.click(view.getByLabelText('选择字体'))
  const search = view.getByLabelText('搜索字体'); fireEvent.change(search, { target: { value: '思源' } })
  const option = await view.findByRole('option', { name: /思源黑体/ })
  fireEvent.pointerEnter(option.parentElement!); await waitFor(() => expect(view.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ family: 'Source Han Sans' })))
  expect(view.onSelect).not.toHaveBeenCalled(); fireEvent.pointerLeave(view.getByRole('listbox')); expect(view.onPreview).toHaveBeenLastCalledWith(null)
  fireEvent.change(search, { target: { value: 'source' } }); fireEvent.keyDown(search, { key: 'ArrowDown' }); fireEvent.keyDown(search, { key: 'Enter' })
  await waitFor(() => expect(view.onSelect).toHaveBeenCalledTimes(1)); expect(view.onSelect.mock.calls[0][0]).toBe('Source Han Sans Regular')
  expect(view.onPreview).toHaveBeenLastCalledWith(null)
})
it('分类与收藏持久化、Esc恢复，千款字体只挂载可视行', async () => {
  const view = picker(); fireEvent.click(view.getByLabelText('选择字体'))
  await waitFor(() => expect(view.getAllByRole('option').length).toBeGreaterThan(0)); expect(view.getAllByRole('option').length).toBeLessThan(100)
  fireEvent.click(view.getByLabelText('字体分类')); fireEvent.click(await view.findByText('已导入'))
  const imported = await view.findByRole('option', { name: /Imported Serif/ }); expect(view.queryByRole('option', { name: /思源黑体/ })).toBeNull()
  fireEvent.click(view.getByLabelText('收藏Imported Serif'))
  expect(fontLibrarySnapshot().preferences.favorites).toContain('Imported Serif'); await waitFor(() => expect(boundary.saved).toHaveBeenCalled())
  fireEvent.pointerEnter(imported.parentElement!); await waitFor(() => expect(view.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ imported: true })))
  fireEvent.keyDown(view.getByLabelText('搜索字体'), { key: 'Escape' }); expect(view.onPreview).toHaveBeenLastCalledWith(null); expect(view.onSelect).not.toHaveBeenCalled()
})
it('样式下拉只提供该家族声明的实际样式，精确样式名作为工程值', async () => {
  const view = picker(vi.fn(), vi.fn(), 'Source Han Sans Regular')
  fireEvent.click(view.getByLabelText('选择字体样式')); fireEvent.click(await view.findByText('Bold'))
  await waitFor(() => expect(view.onSelect.mock.calls[0][0]).toBe('Source Han Sans Bold'))
  await act(async () => undefined)
})
it('导入与删除走唯一原生字体入口，成功后立即更新列表', async () => {
  boundary.imported.mockImplementation(async () => { boundary.faces.push({ ...GENERIC_FONT_FACES[0], id: 'new-import', family: 'New Import', fullName: 'New Import', localizedFamily: '新导入', imported: true, aliases: [] }); return { faces: boundary.faces, revision: 2 } })
  boundary.removed.mockImplementation(async (id: string) => { boundary.faces = boundary.faces.filter(face => face.id !== id); return { faces: boundary.faces, revision: 3 } })
  const view = picker(vi.fn(), vi.fn(), 'Imported Serif'); fireEvent.click(view.getByLabelText('选择字体'))
  fireEvent.click(view.getByLabelText('导入字体')); await waitFor(() => expect(boundary.imported).toHaveBeenCalledTimes(1))
  fireEvent.change(view.getByLabelText('搜索字体'), { target: { value: '新导入' } }); await view.findByRole('option', { name: /新导入/ })
  fireEvent.click(view.getByRole('button', { name: '删除此导入字体' })); await waitFor(() => expect(boundary.removed).toHaveBeenCalledWith('imported'))
  await waitFor(() => expect(fontLibrarySnapshot().faces.some(face => face.id === 'imported')).toBe(false))
})
