import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ default: { existsSync: () => true } }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { invokeAudioWorker } from './audio-worker-client'

afterEach(() => { vi.clearAllMocks() })

function child() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false, kill: vi.fn() })
}

it('exit 先于 stdout 尾行时等待 close，正常响应不会丢失', async () => {
  const process = child()
  mocks.spawn.mockReturnValue(process)
  const result = invokeAudioWorker<{ processed: boolean }>({ command: 'process' })
  const settled = result.then(value => ({ value }), error => ({ error }))
  const request = JSON.parse(process.stdin.read().toString()) as { id: string }
  process.emit('exit', 0)
  process.stdout.end(`${JSON.stringify({ version: 1, id: request.id, ok: true, result: { processed: true } })}\n`)
  await new Promise(resolve => setImmediate(resolve))
  process.emit('close', 0)
  expect(await settled).toEqual({ value: { processed: true } })
})

it.each([0, 7])('无响应 close %s 仍报告失败，非零退出保留 stderr', async code => {
  const process = child()
  mocks.spawn.mockReturnValue(process)
  const result = invokeAudioWorker({ command: 'inspect' })
  const assertion = expect(result).rejects.toThrow(code ? '7）：plugin failed' : '未返回处理结果')
  process.stderr.write('plugin failed')
  process.stdout.end()
  process.emit('exit', code)
  process.emit('close', code)
  await assertion
})
