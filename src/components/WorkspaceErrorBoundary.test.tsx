/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const logged = vi.hoisted(() => [] as Array<{ domain: string; message: string; fields: Record<string, unknown> }>)
vi.mock('@/core/logging', () => ({
  createLogger: (domain: string) => ({
    error: (message: string, fields: Record<string, unknown>) => { logged.push({ domain, message, fields }) },
  }),
}))

import { DockPanelErrorBoundary, WorkspaceErrorBoundary } from './WorkspaceErrorBoundary'

const crash = { on: true }
function Editor(): JSX.Element {
  if (crash.on) throw new Error('timeline exploded')
  return <div>editor-ready</div>
}

afterEach(() => { cleanup(); logged.length = 0; crash.on = true; vi.restoreAllMocks() })

describe('WorkspaceErrorBoundary', () => {
  it('只把出错的工作区换成报错，兄弟内容保留，重新加载后恢复并写日志', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <div>
        <div>title-bar</div>
        <WorkspaceErrorBoundary surfaceId="workspace.video_edit"><Editor /></WorkspaceErrorBoundary>
        <WorkspaceErrorBoundary surfaceId="workspace.canvas"><div>canvas-ready</div></WorkspaceErrorBoundary>
      </div>,
    )

    expect(screen.getByText('这个工作区出了问题')).toBeTruthy()
    expect(screen.getByText('title-bar')).toBeTruthy()
    expect(screen.getByText('canvas-ready')).toBeTruthy()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      domain: 'app.workspace',
      fields: { event: 'workspace.ui.crashed', scope: 'workspace', surfaceId: 'workspace.video_edit', message: 'timeline exploded' },
    })
    expect(String(logged[0].fields.componentStack)).toContain('Editor')

    crash.on = false
    fireEvent.click(screen.getByRole('button', { name: '重新加载工作区' }))
    expect(screen.getByText('editor-ready')).toBeTruthy()
    expect(screen.queryByText('这个工作区出了问题')).toBeNull()
  })

  it('停靠面板出错只换掉该面板，日志带工作区与面板标识', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <div>
        <DockPanelErrorBoundary workspace="audio_edit" panelId="transcript"><Editor /></DockPanelErrorBoundary>
        <DockPanelErrorBoundary workspace="audio_edit" panelId="editor"><div>wave-ready</div></DockPanelErrorBoundary>
      </div>,
    )

    expect(screen.getByText('这个面板出了问题')).toBeTruthy()
    expect(screen.getByText('wave-ready')).toBeTruthy()
    expect(logged[0]).toMatchObject({ fields: { event: 'dock_panel.ui.crashed', scope: 'panel', workspace: 'audio_edit', panelId: 'transcript' } })

    crash.on = false
    fireEvent.click(screen.getByRole('button', { name: '重新加载面板' }))
    expect(screen.getByText('editor-ready')).toBeTruthy()
  })
})
