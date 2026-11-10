import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('./appBasePaths', () => ({ getProgramDataDir: () => state.dir }))
import { isCommandLineProcessRunning } from './command-line-marker'

afterEach(() => { fs.rmSync(state.dir, { recursive: true, force: true }) })

it('只认仍在运行的其他进程；已退出进程留下的标记视为陈旧并删掉', () => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-cli-marker-'))
  expect(isCommandLineProcessRunning()).toBe(false)
  const markers = path.join(state.dir, 'command-line-processes')
  fs.mkdirSync(markers)
  fs.writeFileSync(path.join(markers, String(process.pid)), '')
  // 进程号上限远小于这个值，不可能有进程在用它。
  fs.writeFileSync(path.join(markers, '2147483646'), '')
  expect(isCommandLineProcessRunning()).toBe(false)
  expect(fs.readdirSync(markers)).toEqual([String(process.pid)])
  fs.writeFileSync(path.join(markers, String(process.ppid)), '')
  expect(isCommandLineProcessRunning()).toBe(true)
})
