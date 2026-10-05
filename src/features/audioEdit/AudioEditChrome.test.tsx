/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { AudioEditFileMenu } from './AudioEditTextTools'
import { AudioEditViewSettings } from './AudioEditViewSettings'

/**
 * 口播剪辑外壳（界面重设计 5.5 第二批）：界面设置不再用系统原生下拉（不随主题、不能键盘高亮），
 * 文件菜单只有重命名与重新定位原素材（3.3：删除在口播列表右键里，移到回收站）。
 */

afterEach(cleanup)

describe('口播剪辑外壳', () => {
  it('界面设置用主题下拉而不是原生 select', () => {
    const view = render(<AudioEditViewSettings open onClose={vi.fn()} value={DEFAULT_AUDIO_EDIT_VIEW_SETTINGS} onChange={vi.fn()} />)
    expect(view.baseElement.querySelector('select')).toBeNull()
    expect(screen.getByRole('button', { name: '整个界面缩放' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '波形上方显示字幕' })).toBeTruthy()
  })

  it('文件菜单：重命名与重新定位原素材；双击直接改名，名称没变不提交', async () => {
    const onRename = vi.fn()
    render(<AudioEditFileMenu name="口播 1" disabled={false} onRename={onRename} onRelink={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /口播 1/ }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['重命名', '重新定位原素材'])
    fireEvent.click(items[0])
    const input = await screen.findByRole('textbox', { name: '口播名' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByRole('button', { name: /口播 1/ }))
    const again = await screen.findByRole('textbox', { name: '口播名' })
    fireEvent.change(again, { target: { value: '口播 2' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('口播 2'))
  })
})
