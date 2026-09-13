// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(path.resolve('scripts/run-assistant-cli.cjs'), 'utf8')
function launch(failure?: string) {
  const child = new EventEmitter()
  const spawn = vi.fn(() => child)
  const assertBuildFreshness = vi.fn(() => { if (failure === 'stale') throw new Error('构建产物比源码旧') })
  const process = { argv: ['node', 'runner', '--goal', '读取当前画布'], env: { ELECTRON_RUN_AS_NODE: '1' },
    stderr: { write: vi.fn() }, exitCode: undefined as number | undefined,
    exit: vi.fn(() => { throw new Error('EXIT') }) }
  const modules: Record<string, unknown> = {
    'node:fs': { existsSync: () => failure !== 'missing' }, 'node:path': path,
    'node:child_process': { spawn }, electron: 'electron-fixture', './lib/electronLaunch.cjs': { assertBuildFreshness },
  }
  try { runInNewContext(source, { require: (id: string) => modules[id], __dirname: path.resolve('scripts'), process }) }
  catch (error) { if (!(error instanceof Error) || error.message !== 'EXIT') throw error }
  return { child, spawn, assertBuildFreshness, process }
}

describe('助手 CLI 使用当前构建产物', () => {
  it.each(['missing', 'stale'])('产物 %s 时不启动模型进程', failure => {
    const result = launch(failure)
    expect(result.spawn).not.toHaveBeenCalled()
    expect(result.process.stderr.write).toHaveBeenCalled()
    if (failure === 'stale') expect(result.process.exit).toHaveBeenCalledWith(1)
    else expect(result.process.exitCode).toBe(1)
  })
  it('新鲜产物才传递原参数，子进程失败不会被当成验证通过', () => {
    const result = launch()
    expect(result.assertBuildFreshness).toHaveBeenCalledWith(path.resolve('out/main/index.cjs'))
    expect(result.spawn).toHaveBeenCalledWith('electron-fixture', [path.resolve('.'), '--assistant-cli', '--goal', '读取当前画布'],
      expect.objectContaining({ env: {}, windowsHide: true }))
    result.child.emit('exit', 1, null)
    expect(result.process.exitCode).toBe(1)
  })
})
