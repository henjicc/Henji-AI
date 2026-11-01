import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { WebCacheFonts } from './fonts'

it('字体签名读取真实字节，补装、同尺寸同时间改写和改回均撤销已登记环境', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-fonts-'))
  const file = path.join(root, 'fixture.ttf')
  let first: WebCacheFonts | undefined, second: WebCacheFonts | undefined
  try {
    await fs.writeFile(file, 'AAAA')
    first = await WebCacheFonts.begin(undefined, [root])
    expect(await first.validate()).toBe(true)
    const stat = await fs.stat(file)
    await fs.writeFile(file, 'BBBB'); await fs.utimes(file, stat.atime, stat.mtime)
    expect(await first.validate()).toBe(false)
    second = await WebCacheFonts.begin(undefined, [root])
    expect(second.signature).not.toBe(first.signature)
    await fs.writeFile(file, 'AAAA')
    expect(await second.validate()).toBe(false)
  } finally { first?.close(); second?.close(); await fs.rm(root, { recursive: true, force: true }) }
})
