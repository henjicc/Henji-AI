import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ logDir: '' }))

vi.mock('./writer', () => ({
  getLogDir: () => state.logDir,
}))

import { queryLogEvents } from './query'

const DATE = '2026-08-22'

describe('结构化日志查询', () => {
  beforeEach(async () => {
    state.logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-log-query-'))
  })

  afterEach(async () => {
    const tempRoot = path.resolve(os.tmpdir())
    const resolved = path.resolve(state.logDir)
    if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('henji-log-query-')) {
      await fs.rm(resolved, { recursive: true, force: true })
    }
  })

  it('按场景起始时间截取事件，不读取更早的历史噪声', async () => {
    const events = [
      { timestamp: '2026-08-22T06:00:00.000Z', level: 'error', source: 'backend', domain: 'old', event: 'old.failed', message: '旧错误' },
      { timestamp: '2026-08-22T06:00:01.000Z', level: 'warn', source: 'frontend', domain: 'cameraStage', event: 'camera.warned', message: '本场景警告' },
      { timestamp: '2026-08-22T06:00:02.000Z', level: 'error', source: 'backend', domain: 'cameraStage', event: 'camera.failed', message: '本场景错误' },
    ]
    await fs.writeFile(
      path.join(state.logDir, `henji-${DATE}.log`),
      `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    )

    const result = await queryLogEvents({
      date: DATE,
      afterTimestamp: '2026-08-22T06:00:01.000Z',
      domainPrefix: 'cameraStage',
      limit: 20,
    })

    expect(result.events.map((event) => event.event)).toEqual(['camera.failed', 'camera.warned'])
    expect(result.hasMore).toBe(false)
  })
})
