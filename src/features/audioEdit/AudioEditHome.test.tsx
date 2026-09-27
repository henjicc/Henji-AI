/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEditHome } from './AudioEditHome'
import type { AudioEditProjectSummary } from '@/core/audioEdit/types'

afterEach(cleanup)
const callbacks = () => ({ onImport: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn() })
const projects: AudioEditProjectSummary[] = Array.from({ length: 13 }, (_, index) => ({
  id: String(index), name: `口播 ${index + 1}`, mediaType: 'audio', durationFrames: 48000, sampleRate: 48000, updatedAt: 1,
}))

describe('口播工程列表', () => {
  it('空工程提供导入入口，加载和失败不能显示成空工程', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '导入音频或视频' }))
    expect(actions.onImport).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '工程分页' })).toBeNull()
  })

  it('跨页搜索从首页展示结果，无匹配时可清除并恢复列表', () => {
    const actions = callbacks()
    render(<AudioEditHome projects={projects} loading={false} loadFailed={false} disabled={false} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: /口播 13/ }))
    expect(actions.onOpen).toHaveBeenLastCalledWith('12')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索工程' }), { target: { value: '口播 2' } })
    expect(screen.queryByRole('navigation', { name: '工程分页' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /口播 2/ }))
    expect(actions.onOpen).toHaveBeenLastCalledWith('1')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索工程' }), { target: { value: '不存在' } })
    expect(screen.queryByRole('button', { name: /继续编辑/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(screen.getAllByRole('button', { name: /继续编辑/ })).toHaveLength(12)
    expect(screen.getByRole('navigation', { name: '工程分页' })).toBeTruthy()
  })

  it('工程减少后不会停在空白页，忙碌时不能重复打开工程', () => {
    const actions = callbacks()
    const props = { projects, loading: false, loadFailed: false, disabled: false, ...actions }
    const view = render(<AudioEditHome {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    view.rerender(<AudioEditHome {...props} projects={projects.slice(0, 2)} disabled />)
    expect(screen.getAllByRole('button', { name: /继续编辑/ })).toHaveLength(2)
    expect(screen.queryByRole('navigation', { name: '工程分页' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /口播 1/ }))
    expect(actions.onOpen).not.toHaveBeenCalled()
  })
})
