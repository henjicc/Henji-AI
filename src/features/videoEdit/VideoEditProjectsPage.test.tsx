/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoEditProjectsPage } from './VideoEditProjectsPage'

afterEach(cleanup)

const handlers = () => ({ onCreate: vi.fn(), onOpenFile: vi.fn(), onOpen: vi.fn() })

describe('剪辑项目页', () => {
  it('没有项目时只有新建项目（主按钮）与打开项目文件', () => {
    const actions = handlers()
    render(<VideoEditProjectsPage projects={[]} {...actions} />)
    const create = screen.getByRole('button', { name: '新建项目' })
    expect(create.getAttribute('data-variant')).toBe('primary')
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
    fireEvent.click(create)
    expect(actions.onCreate).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '打开项目文件' }))
    expect(actions.onOpenFile).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('有项目时卡片显示文件位置，点开交回原项目；缺失文件显示“文件不存在”', () => {
    const actions = handlers()
    const projects = [
      { id: 'a', name: '旅行 Vlog', path: '/projects/旅行 Vlog.henji-video' },
      { id: 'b', name: '旧项目', path: '/projects/旧项目.henji-video', missing: true },
    ]
    render(<VideoEditProjectsPage projects={projects} {...actions} />)
    expect(screen.getByText('2 个项目')).toBeTruthy()
    expect(screen.getByText('/projects/旅行 Vlog.henji-video')).toBeTruthy()
    expect(screen.getByText('文件不存在')).toBeTruthy()
    // 剪辑项目不在这里改名或删除：没有“更多”菜单
    expect(screen.queryByRole('button', { name: '项目操作' })).toBeNull()
    fireEvent.click(document.querySelector('[data-project-id="a"]')!)
    expect(actions.onOpen).toHaveBeenCalledWith(projects[0])
    // 页头：新建仍是唯一主按钮，打开项目文件为静默次要动作
    expect(screen.getByRole('button', { name: '打开项目文件' }).getAttribute('data-variant')).toBe('quiet')
  })
})
