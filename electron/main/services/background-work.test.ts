import { expect, it } from 'vitest'
import { holdBackgroundWork } from './background-work'

it('同一页面的几份持有都放开后才恢复原来的节流设置，重复放开不多减', () => {
  let throttling = true
  const contents = { getBackgroundThrottling: () => throttling, setBackgroundThrottling: (value: boolean) => { throttling = value }, isDestroyed: () => false }
  const popout = holdBackgroundWork(contents)
  const render = holdBackgroundWork(contents)
  expect(throttling).toBe(false)
  popout(); popout()
  expect(throttling).toBe(false)
  render()
  expect(throttling).toBe(true)
})
