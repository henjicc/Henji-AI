import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSourceContent } from './content'
import { webSourceContentHash } from './site'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

it('没有页面开着也监视持有的文件夹；文件夹被整个删掉再重建后仍能发现改动并通知', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-web-content-'))
  const root = path.join(base, '站')
  const writeSite = (script: string): void => { fs.mkdirSync(path.join(root, 'assets'), { recursive: true }); fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>'); fs.writeFileSync(path.join(root, 'assets', 'app.js'), script) }
  writeSite('export {}')
  const changes: Array<{ hash: string; paths: string[] }> = []
  const content = new WebSourceContent((_root, hash, paths) => changes.push({ hash, paths }), { info: () => undefined, warn: () => undefined })
  cleanups.push(() => { content.dispose(); fs.rmSync(base, { recursive: true, force: true }) })
  content.hold(root)
  content.request(root, [path.join(root, 'index.html')])
  expect(await content.current(root)).toBe(await webSourceContentHash(root))

  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export const first = true')
  const edited = await webSourceContentHash(root)
  await vi.waitFor(() => expect(changes.at(-1)).toEqual({ hash: edited, paths: [path.join(root, 'index.html')] }), { timeout: 5000, interval: 50 })

  fs.rmSync(root, { recursive: true, force: true })
  await new Promise(resolve => setTimeout(resolve, 600))
  writeSite('export const rebuilt = true')
  const rebuilt = await webSourceContentHash(root)
  await vi.waitFor(() => expect(changes.at(-1)?.hash).toBe(rebuilt), { timeout: 10000, interval: 100 })
  expect(await content.current(root)).toBe(rebuilt)

  // 重建之后的监视仍然有效：再改一次也能发现。
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export const again = true')
  const again = await webSourceContentHash(root)
  await vi.waitFor(() => expect(changes.at(-1)?.hash).toBe(again), { timeout: 5000, interval: 50 })
}, 30_000)
