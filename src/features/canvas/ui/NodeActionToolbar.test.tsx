/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../domain/canvasNodes'
import { canvasEventBus } from '../application/canvasServices'
import { NodeActionToolbar } from './NodeActionToolbar'

const { copyImage, copyText } = vi.hoisted(() => ({ copyImage: vi.fn(), copyText: vi.fn() }))
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, values?: { reason?: string }) => values?.reason ? `${key}: ${values.reason}` : key }),
}))
vi.mock('@/commands/image', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/commands/image')>(),
  copyImageSourceToClipboard: copyImage,
}))
vi.mock('@/features/assets/hooks/useAddToAssetLibrary', () => ({
  useAddToAssetLibrary: () => ({ addMedia: vi.fn(), collecting: false }),
}))
vi.mock('./CanvasImageCapabilityActions', () => ({ CanvasImageCapabilityActions: () => null }))

const nodes = [
  { id: 'copy-image', type: 'uploadNode', position: { x: 0, y: 0 }, data: { imageUrl: 'https://fixture.invalid/image.png', aspectRatio: '1:1' } },
  { id: 'copy-text', type: 'storyboardGenNode', position: { x: 0, y: 0 }, data: { frames: [{ id: 'frame', description: '测试分镜' }] } },
] as CanvasNode[]

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('工具栏复制结果反馈', () => {
  it.each([0, 1])('复制完成前不报成功，完成后才反馈：%i', async (index) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copyText } })
    let complete!: () => void
    const copy = index === 0 ? copyImage : copyText
    copy.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve }))
    const view = render(<NodeActionToolbar node={nodes[index]} />)
    fireEvent.click(view.getByRole('button', { name: index === 0 ? 'nodeToolbar.copy' : 'nodeToolbar.copyText' }))
    expect(view.queryByRole('button', { name: 'ui:workspace.toast.copySuccess' })).toBeNull()
    await act(async () => complete())
    expect(view.getByRole('button', { name: 'ui:workspace.toast.copySuccess' })).toBeTruthy()
  })

  it.each([0, 1])('复制失败不显示成功，并提示具体原因：%i', async (index) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copyText } })
    const copy = index === 0 ? copyImage : copyText
    copy.mockRejectedValue(new Error('剪贴板不可写入'))
    const publish = vi.spyOn(canvasEventBus, 'publish')
    const view = render(<NodeActionToolbar node={nodes[index]} />)
    await act(async () => fireEvent.click(view.getByRole('button', { name: index === 0 ? 'nodeToolbar.copy' : 'nodeToolbar.copyText' })))
    expect(view.queryByRole('button', { name: 'ui:workspace.toast.copySuccess' })).toBeNull()
    expect(publish).toHaveBeenCalledWith('canvas/toast', expect.objectContaining({ type: 'error', message: expect.stringContaining('剪贴板不可写入') }))
  })
})

vi.mock('@/commands/assetLibrary', () => ({ checkAssetPaths: vi.fn(async () => [false]) }))
import { checkAssetPaths } from '@/commands/assetLibrary'
it('位置、选中和无关数据变化不重复查询资产，媒体变化才查询', async () => {
  const node = { id: 'drag-media', type: 'uploadNode', position: { x: 0, y: 0 }, data: { imageUrl: 'D:/fixture/a.jpg', aspectRatio: '2:3' } } as CanvasNode
  const view = render(<NodeActionToolbar node={node} />)
  await act(async () => {})
  expect(checkAssetPaths).toHaveBeenCalledTimes(1)
  for (let x = 1; x <= 60; x++) await act(async () => {
    view.rerender(<NodeActionToolbar node={{ ...node, position: { x, y: 0 }, dragging: true }} />)
  })
  await act(async () => view.rerender(<NodeActionToolbar node={{ ...node, data: { ...node.data, displayName: '新名称' } }} />))
  expect(checkAssetPaths).toHaveBeenCalledTimes(1)
  await act(async () => view.rerender(<NodeActionToolbar node={{ ...node, data: { ...node.data, imageUrl: 'D:/fixture/b.jpg' } }} />))
  expect(checkAssetPaths).toHaveBeenCalledTimes(2)
  expect(checkAssetPaths).toHaveBeenLastCalledWith(['D:/fixture/b.jpg'])
})
