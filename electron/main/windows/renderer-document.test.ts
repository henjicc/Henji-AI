import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
import { onRendererDocumentReplaced } from './renderer-document'

it('导航提交或主帧提交成错误页才算换页；被拦下、子框架失败与开始导航都不算', () => {
  const contents = Object.assign(new EventEmitter(), { off: EventEmitter.prototype.removeListener }) as unknown as WebContents & EventEmitter
  const listener = vi.fn()
  const stop = onRendererDocumentReplaced(contents, listener)
  contents.emit('did-start-navigation', {}, 'file://x', false, true)
  contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://blocked', true)
  contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://frame', false)
  expect(listener).not.toHaveBeenCalled()
  contents.emit('did-fail-provisional-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file://index.html', true)
  contents.emit('did-navigate', {}, 'file://index.html', 200, 'OK')
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
  contents.emit('did-navigate', {}, 'file://index.html', 200, 'OK')
  expect(listener).toHaveBeenCalledTimes(2)
})
