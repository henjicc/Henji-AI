/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { AudioEditHome } from './AudioEditHome'
import type { AudioEditProjectSummary } from '@/core/audioEdit/types'

afterEach(cleanup)
// UiError 的“重试”走 i18n（任务 5.8）：断言按中文界面
beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
const callbacks = () => ({ onImport: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(async () => undefined) })
const projects: AudioEditProjectSummary[] = Array.from({ length: 3 }, (_, index) => ({
  id: String(index), name: `口播 ${index + 1}`, mediaType: index === 0 ? 'video' : 'audio', durationFrames: 48000 * 65, sampleRate: 48000, updatedAt: index + 1,
}))
const card = (id: string): HTMLElement => document.querySelector(`[data-project-id="${id}"]`) as HTMLElement
const contextMenu = (): HTMLElement => document.querySelector('[data-context-menu]') as HTMLElement

describe('口播项目页', () => {
  it('没有项目时只有导入入口；加载和失败不能显示成没有项目', () => {
    const actions = callbacks()
    const props = { projects: [], loading: true, loadFailed: false, disabled: false, ...actions }
    const view = render(<AudioEditHome {...props} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '导入音频或视频' })).toBeNull()
    view.rerender(<AudioEditHome {...props} loading={false} loadFailed />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(actions.onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '导入音频或视频' })).toBeNull()
    view.rerender(<AudioEditHome {...props} loading={false} />)
    expect(screen.getByText('从一段口播开始')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导入音频或视频' }))
    expect(actions.onImport).toHaveBeenCalledOnce()
    // 空态只有新建提示：没有搜索、排序与数量
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/个项目/)).toBeNull()
  })

  it('有项目时按卡片打开，搜索只筛选本页显示', () => {
    const actions = callbacks()
    render(<AudioEditHome projects={projects} loading={false} loadFailed={false} disabled={false} {...actions} />)
    expect(screen.getByText('3 个项目')).toBeTruthy()
    expect(card('0').getAttribute('data-project-meta')).toBe(`视频 · 1:05 · ${new Date(1).toLocaleDateString()}`)
    fireEvent.click(card('1'))
    expect(actions.onOpen).toHaveBeenLastCalledWith('1')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目' }), { target: { value: '口播 3' } })
    expect(document.querySelectorAll('[data-project-id]')).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有符合条件的项目')).toBeTruthy()
  })

  it('右键可重命名与删除，删除前确认并说明原素材保留', async () => {
    const actions = callbacks()
    render(<AudioEditHome projects={projects} loading={false} loadFailed={false} disabled={false} {...actions} />)
    fireEvent.contextMenu(card('2'))
    fireEvent.click(within(contextMenu()).getByText('重命名'))
    const input = await screen.findByDisplayValue('口播 3')
    fireEvent.change(input, { target: { value: '新名字' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(actions.onRename).toHaveBeenCalledWith('2', '新名字'))

    fireEvent.contextMenu(card('1'))
    fireEvent.click(within(contextMenu()).getByText('删除'))
    expect(await screen.findByText('确定删除「口播 2」？只删除项目和缓存，原素材保持不变。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(actions.onDelete).toHaveBeenCalledWith(['1']))
  })

  it('忙碌时不能重复打开项目或再次导入', () => {
    const actions = callbacks()
    render(<AudioEditHome projects={projects} loading={false} loadFailed={false} disabled {...actions} />)
    fireEvent.click(card('0'))
    expect(actions.onOpen).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '导入音频或视频' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
