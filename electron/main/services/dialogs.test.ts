import path from 'node:path'
import { expect, it } from 'vitest'
import { resolveDialogDefaultPath } from './dialogs'

it('没给位置时从上次目录打开；只给文件名时放进上次目录；绝对路径原样保留', () => {
  const last = path.resolve('上次')
  expect(resolveDialogDefaultPath(undefined, last)).toBe(last)
  expect(resolveDialogDefaultPath('导出.png', last)).toBe(path.join(last, '导出.png'))
  const absolute = path.resolve('别处', 'a.zip')
  expect(resolveDialogDefaultPath(absolute, last)).toBe(absolute)
  expect(resolveDialogDefaultPath('导出.png', null)).toBe('导出.png')
})
