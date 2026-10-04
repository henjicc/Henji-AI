// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog'

afterEach(cleanup)

describe('SettingsDialog 动作档位', () => {
  it('只有破坏性确认时用危险实底（确认弹窗）', () => {
    render(
      <SettingsDialog
        open
        title="清空"
        actions={[
          { label: '取消', onClick: vi.fn(), variant: 'secondary' },
          { label: '清空', onClick: vi.fn(), variant: 'danger' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: '清空' }).className).toContain('ui-btn-danger-solid')
  })

  it('已有主按钮时破坏性选项降为 danger 档，整个弹窗只有一个实底按钮', () => {
    render(
      <SettingsDialog
        open
        title="目标目录已有数据"
        actions={[
          { label: '合并', onClick: vi.fn(), variant: 'primary' },
          { label: '覆盖', onClick: vi.fn(), variant: 'danger' },
          { label: '取消', onClick: vi.fn(), variant: 'secondary' },
        ]}
      />,
    )
    const overwrite = screen.getByRole('button', { name: '覆盖' })
    expect(overwrite.className).toContain('ui-btn-danger')
    expect(overwrite.className).not.toContain('ui-btn-danger-solid')
    expect(screen.getByRole('button', { name: '合并' }).className).toContain('ui-btn-primary')
  })
})
