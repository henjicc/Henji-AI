/** @vitest-environment jsdom */
import '@/tests/imageEditDocumentFixture'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { createImageEditDocumentV3, createImageEditPathLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createImageEditTextLayerV3 } from '@/core/imageEdit/v3/layerEntries/vector'
import { getOrCreateImageEditDocumentInstanceV3 } from '../../application/imageEditDocumentInstances'
import type { ImageEditorV3Controller } from '../../editor/types'
import { VectorProperties } from './VectorProperties'

vi.mock('@/components/typography/TypographyPanel', () => ({ TypographyPanel: () => null }))
beforeEach(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('没有可编辑目标时隐藏路径蒙版，有目标时提供入口，目标失效后不能提交', () => {
  const document = createImageEditDocumentV3({ width: 400, height: 300, documentId: 'path-mask-availability' })
  const layer = createImageEditPathLayerV3('path', '路径')
  const target = createImageEditRasterLayerV3('target', '原图')
  document.layers = [layer, { ...target, locked: true }]
  const controller = { document, sessionId: document.id } as ImageEditorV3Controller
  const view = render(<VectorProperties controller={controller} layer={layer} locked={false} />)
  expect(screen.queryByRole('button', { name: '蒙版目标图层' })).toBeNull()
  document.layers = [layer, target]
  view.rerender(<VectorProperties controller={controller} layer={layer} locked={false} />)
  fireEvent.click(screen.getByRole('button', { name: '蒙版目标图层' }))
  fireEvent.click(screen.getByRole('option', { name: '原图' }))
  expect((screen.getByRole('button', { name: '用路径作为蒙版' }) as HTMLButtonElement).disabled).toBe(false)
  document.layers = [layer, createImageEditRasterLayerV3('other', '另一图层')]
  view.rerender(<VectorProperties controller={controller} layer={layer} locked={false} />)
  expect(screen.getByRole('button', { name: '用路径作为蒙版' }).getAttribute('aria-disabled')).toBe('true')
})

it('文字属性连续修改经正式内容服务合并为一步历史，撤销读回原内容', () => {
  vi.useFakeTimers()
  const document = createImageEditDocumentV3({ width: 400, height: 300, documentId: 'typing-history' })
  const layer = createImageEditTextLayerV3('text-layer', '标题')
  document.layers = [layer]
  const { bus } = getOrCreateImageEditDocumentInstanceV3(document)
  const controller = { document, sessionId: document.id } as ImageEditorV3Controller
  render(<VectorProperties controller={controller} layer={layer} locked={false} />)
  const input = screen.getByRole('textbox', { name: '图层文字内容' })
  fireEvent.change(input, { target: { value: '连续' } })
  act(() => vi.advanceTimersByTime(200))
  fireEvent.change(input, { target: { value: '连续输入标题' } })
  expect(bus.getSnapshot().document.revision).toBe(0)
  act(() => vi.advanceTimersByTime(400))
  expect(bus.getSnapshot().document.revision).toBe(1)
  fireEvent.blur(input)
  expect(bus.getSnapshot().document.revision).toBe(1)
  const updated = bus.getSnapshot().document.layers[0]
  expect(updated.type).toBe('text')
  if (updated.type === 'text') expect(updated.content.paragraphs[0].runs[0].text).toBe('连续输入标题')
  expect(bus.undo()).toBe(true)
  expect(bus.getSnapshot().document.layers[0]).toEqual(layer)
  expect(bus.undo()).toBe(false)
})
