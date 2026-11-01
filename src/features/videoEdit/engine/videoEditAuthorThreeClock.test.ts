import { expect, it, vi } from 'vitest'
import { VideoEditAuthorThreeClock } from './videoEditAuthorThreeClock'

it('编译、嵌套计算与渲染的内部 update 保持一个宿主样本，失败恢复更新方法', async () => {
  const update = vi.fn(), stop = vi.fn()
  const nodeFrame = { time: 0, deltaTime: 0, frameId: 0, renderId: 10, update }
  const renderer = { _animation: { stop }, _nodes: { nodeFrame }, info: { frame: 0 } }
  const clock = new VideoEditAuthorThreeClock(renderer, '186')
  for (const time of [0, 37, 12, 37, 37]) {
    const id = nodeFrame.frameId + 1
    await clock.run(time, async () => {
      nodeFrame.update()
      await Promise.resolve()
      nodeFrame.update()
      expect([nodeFrame.time, nodeFrame.deltaTime, nodeFrame.frameId, renderer.info.frame, nodeFrame.renderId]).toEqual([time, 0, id, id, 10])
      await expect(clock.run(4, () => {})).rejects.toThrow('串行')
    })
  }
  await expect(clock.run(9, () => { throw new Error('compile failed') })).rejects.toThrow('compile failed')
  expect(nodeFrame.update).toBe(update)
  expect(update).not.toHaveBeenCalled()
  expect(stop).toHaveBeenCalled()
  expect(() => new VideoEditAuthorThreeClock(renderer, '187')).toThrow('r186')
})
