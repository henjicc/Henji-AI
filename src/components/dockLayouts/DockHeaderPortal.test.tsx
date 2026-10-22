/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DockHeaderPortal } from './DockHeaderPortal'
import { setDockHeaderSlot } from './dockHeaderSlots'

afterEach(() => { cleanup(); setDockHeaderSlot('video_edit:project', null) })

it('有标签行插槽时工具放进标签行，插槽消失（浮出窗口、切走标签）时回到面板内原位', () => {
  const view = render(<div data-panel><DockHeaderPortal panelId="video_edit:project" fallback={tools => <div data-inline>{tools}</div>}><button>导入</button></DockHeaderPortal></div>)
  expect(view.container.querySelector('[data-inline] button')).not.toBeNull()
  const slot = document.createElement('div'); document.body.appendChild(slot)
  act(() => setDockHeaderSlot('video_edit:project', slot))
  expect(view.container.querySelector('[data-inline]')).toBeNull()
  expect(slot.querySelector('button')?.textContent).toBe('导入')
  act(() => setDockHeaderSlot('video_edit:project', null))
  expect(view.container.querySelector('[data-inline] button')).not.toBeNull()
  slot.remove()
})
