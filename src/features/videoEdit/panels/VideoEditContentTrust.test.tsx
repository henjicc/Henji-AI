// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ContentTrustRequiredError, type ContentTrustReference, type ContentTrustQuery } from '@/core/contentTrust'
import { createVideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditInstance } from '../application/videoEditService'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'
import { VideoEditTemplatesPanel } from './VideoEditTemplatesPanel'
const state = vi.hoisted(() => ({ allowed: false, listeners: new Set<() => void>(), preview: vi.fn(), run: vi.fn() }))
const foreign: ContentTrustReference = { id: 'external', sourceType: 'template', sourceName: '分享模板' }
vi.mock('../application/videoEditPresetPreview', () => ({ PRESET_PREVIEW_FPS: 30, presetPreviewTimeline: (...args: unknown[]) => state.preview(...args), renderPresetPreviewFrame: vi.fn() }))
vi.mock('@/services/contentTrust', () => ({
  subscribeContentTrustContext: (queries: () => ContentTrustQuery[], listener: () => void) => { const relevant = () => { if (queries().some(query => query.contents.some(record => record.id === 'external'))) listener() }; state.listeners.add(relevant); return () => state.listeners.delete(relevant) },
  runForeignContent: (records: ContentTrustReference[]) => state.run(records),
  executeContentTrust: async ({ query }: { query: ContentTrustQuery }) => ({ state: state.allowed ? 'allowed' : 'denied', records: query.contents }),
}))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: vi.fn() }) }))
vi.mock('../application/videoEditService', () => ({ subscribeVideoEditDomain: () => () => {}, videoEditDomainRevision: () => 0 }))
vi.mock('../application/videoEditTemplates', () => ({}))
vi.mock('../application/videoEditStyleLibrary', () => ({ videoEditStyleLibrary: {
  ready: async () => {}, listStyles: () => [], listTemplates: () => [
    { template: { id: 'external', imported: true, foreign: { id: 'external', sourceType: 'template', sourceName: '分享模板' }, name: '分享模板', description: '', version: 1, body: { kind: 'code', code: { entry: 'main.js', files: { 'main.js': 'code' } } } } },
    { template: { id: 'local', name: '自创模板', description: '', version: 1, body: { kind: 'code', code: { entry: 'main.js', files: { 'main.js': 'code' } } } } },
  ],
} }))
const source = { category: 'template' as const, trustContext: [foreign], body: { kind: 'code' as const, code: { entry: 'main.js', files: { 'main.js': 'code' } } } }
beforeEach(() => {
  state.allowed = false
  state.preview.mockImplementation(() => Promise.reject(new ContentTrustRequiredError('denied', [foreign])))
  state.run.mockImplementation(async () => { state.allowed = true; state.preview.mockImplementation(() => new Promise(() => {})); state.listeners.forEach(listener => listener()) })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); state.listeners.clear() })
it('不运行显示结构化占位，运行按钮进入共同询问入口并原地重试，文字相同的普通错误没有按钮', async () => {
  const view = render(<VideoEditPresetPlayer source={source} size={{ width: 320, height: 180 }} playing={false} label="模板预览" />)
  fireEvent.click(await screen.findByRole('button', { name: '运行' }))
  await waitFor(() => expect(state.preview).toHaveBeenCalledTimes(2))
  expect(state.run).toHaveBeenCalledWith([foreign])
  view.unmount()
  state.preview.mockRejectedValue(new Error('这份内容里的代码尚未运行。'))
  render(<VideoEditPresetPlayer source={source} size={{ width: 320, height: 180 }} playing={false} label="普通错误" />)
  await screen.findByText('这份内容里的代码尚未运行。')
  expect(screen.queryByRole('button', { name: '运行' })).toBeNull()
})
it('模板菜单只为受阻的外来模板显示运行，相关选择只刷新它自己的预览', async () => {
  state.preview.mockImplementation(() => new Promise(() => {}))
  const instance = { document: createVideoEditDocument('测试'), selectedClipIds: [] } as unknown as VideoEditInstance
  const errors = vi.fn()
  render(<VideoEditTemplatesPanel instance={instance} onError={errors} />)
  const external = screen.getByRole('button', { name: /分享模板，/ })
  fireEvent.contextMenu(external)
  fireEvent.click(await screen.findByRole('menuitem', { name: '运行' }))
  await waitFor(() => expect(state.preview).toHaveBeenCalledTimes(3))
  fireEvent.contextMenu(external)
  await screen.findByRole('menuitem', { name: '加到播放头' })
  expect(screen.queryByRole('menuitem', { name: '运行' })).toBeNull()
  state.allowed = false
  fireEvent.contextMenu(screen.getByRole('button', { name: /自创模板，/ }))
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: '运行' })).toBeNull())
  expect(errors).not.toHaveBeenCalled()
})
