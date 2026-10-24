import { expect, it } from 'vitest'
import { parseWorkspaceDockLayout, workspacePanelConstraints } from './validation'

const layout = (panel: Record<string, unknown>) => JSON.stringify({
  grid: { width: 1440, height: 860, orientation: 'HORIZONTAL', root: { type: 'branch', data: [{ type: 'leaf', size: 1440, data: { id: 'g', views: ['a'], activeView: 'a' } }] } },
  panels: { a: { id: 'a', contentComponent: 'a', ...panel } },
})

it('面板最小尺寸以当前定义为准：旧布局补上，过时的值改掉，定义里没有的去掉（重要记录 020）', () => {
  const definitions = [{ id: 'a', title: '素材', minimumWidth: 200, minimumHeight: 180 }]
  expect(parseWorkspaceDockLayout(layout({}), definitions).panels.a).toMatchObject({ title: '素材', minimumWidth: 200, minimumHeight: 180 })
  expect(parseWorkspaceDockLayout(layout({ minimumWidth: 90 }), definitions).panels.a.minimumWidth).toBe(200)
  expect(parseWorkspaceDockLayout(layout({ minimumWidth: 90, minimumHeight: 40 }), [{ id: 'a' }]).panels.a).not.toHaveProperty('minimumWidth')
  expect(workspacePanelConstraints(definitions, 'a')).toEqual({ minimumWidth: 200, minimumHeight: 180 })
  expect(workspacePanelConstraints(definitions, 'b')).toEqual({})
})
