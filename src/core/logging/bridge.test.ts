import { beforeEach, expect, it, vi } from 'vitest'
import type { LogEventBridgeDto } from './types'

const sent: string[][] = []
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true }))
vi.mock('@/commands/logging', () => ({
  logFrontendEvents: async (events: LogEventBridgeDto[]) => {
    if (events.some(event => event.event === 'poison')) throw new Error('Expected log events array')
    sent.push(events.map(event => event.event))
  },
}))

const event = (name: string): LogEventBridgeDto => ({ timestamp: '2026-11-12T00:00:00.000Z', level: 'info', domain: 'test', event: name, message: name })

beforeEach(() => { sent.length = 0 })

it('一条写不进去的事件只丢它自己，前后的事件照常写入并留下原因', async () => {
  const { enqueueFrontendLogForBridge, flushFrontendLogBridge } = await import('./bridge')
  for (const name of ['before', 'poison', 'after']) enqueueFrontendLogForBridge(event(name))
  await flushFrontendLogBridge()
  expect(sent.flat()).toEqual(['before', 'logging.bridge.event_rejected', 'after'])
  enqueueFrontendLogForBridge(event('later'))
  await flushFrontendLogBridge()
  expect(sent.flat().at(-1)).toBe('later')
})
