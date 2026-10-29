import { expect, it } from 'vitest'
import type { WebContents } from 'electron'
import type { WebRecordingBehaviorEvent } from '../../../../../src/core/webReplay/schema'
import type { WebRecordingStore } from '../store'
import { InputDispatcher } from './input'

type Sent = Record<string, unknown>

function dispatcher(locate: (script: string) => { x: number; y: number } | null = () => null): { input: InputDispatcher; sent: Sent[] } {
  const sent: Sent[] = []
  const contents = { executeJavaScript: async (script: string) => locate(script) } as unknown as WebContents
  return { input: new InputDispatcher(contents, async (_method, params) => { sent.push(params ?? {}) }, {} as WebRecordingStore, 'control'), sent }
}

const key = (type: 'down' | 'up', name: string, keyCode: number): WebRecordingBehaviorEvent => ({ kind: 'key', t: 0, type, key: name, code: name, keyCode, location: 0, repeat: false, mods: 0, composing: false })
const press = (type: 'down' | 'move' | 'up', x: number, y: number, replayId?: string): WebRecordingBehaviorEvent => ({
  kind: 'pointer', t: 0, type, x, y, button: type === 'move' ? -1 : 0, buttons: type === 'up' ? 0 : 1, clickCount: type === 'move' ? 0 : 1, pointerType: 'mouse', mods: 0,
  ...(replayId ? { target: { locator: { tag: 'div', path: 'div', replayId }, rect: { x: 0, y: 0, width: 10, height: 10 }, offset: [0.5, 0.5] } } : {}),
})

it('回车按下带着字符派发，页面能收到 keypress 并隐式提交表单；不出字符的键只发 keydown', async () => {
  const { input, sent } = dispatcher()
  for (const event of [key('down', 'Enter', 13), key('up', 'Enter', 13), key('down', 'Escape', 27)]) await input.dispatch(event)
  expect(sent.map(({ type, text }) => ({ type, text }))).toEqual([
    { type: 'keyDown', text: '\r' },
    { type: 'keyUp', text: undefined },
    { type: 'rawKeyDown', text: undefined },
  ])
})

it('按下的元素比录制时偏了几像素：按住时的移动与松开跟着平移，点击仍在原地松开，拖动保持原长', async () => {
  // 被按的卡片此刻比录制时往下 6 像素；松开时指针下录到的是整块画布，按录制坐标定位
  const { input, sent } = dispatcher(script => (script.includes('"card"') ? { x: 101, y: 106 } : null))
  for (const event of [press('down', 100, 100, 'card'), press('up', 100, 100, 'canvas'), press('down', 100, 100, 'card'), press('move', 130, 100), press('up', 130, 100, 'canvas'), press('move', 50, 50)]) await input.dispatch(event)
  expect(sent.map(({ type, x, y }) => `${type} ${x},${y}`)).toEqual([
    'mouseMoved 101,106', 'mousePressed 101,106', 'mouseReleased 101,106',
    'mousePressed 101,106', 'mouseMoved 131,106', 'mouseReleased 131,106',
    'mouseMoved 50,50',
  ])
})
