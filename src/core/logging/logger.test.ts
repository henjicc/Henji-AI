import { expect, it } from 'vitest'
import { createLogger } from './logger'
import { getLogEvents } from './store'

it('error 的两种写法都记下事件名与上下文：错误在前，或与 warn 相同的元信息对象', () => {
  const logger = createLogger('test.logger')
  const cause = new Error('磁盘已满')
  logger.error('写法一', cause, { event: 'test.positional', context: { id: 1 } })
  logger.error('写法二', { event: 'test.meta', error: cause, context: { id: 2 } })
  logger.error('写法三', { requestId: 'r-3', error: cause, context: { id: 3 } })
  const events = getLogEvents().filter(event => event.domain === 'test.logger')
  expect(events.map(event => [event.event, event.context?.id])).toEqual([['test.positional', 1], ['test.meta', 2], [expect.any(String), 3]])
  expect(events[2].requestId).toBe('r-3')
  expect(events.every(event => JSON.stringify(event.error).includes('磁盘已满'))).toBe(true)
})
