import { describe, expect, it } from 'vitest'

import { runHenjiScriptCapability } from './henjiScriptApplicationCapabilities'

/*
 * 回归：run_henji_script 曾经有 maxCallsPerRun: 1。
 *
 * 它想拦的是「模型原地打转」，判的却是「调用了几次」——两件事不是一回事。分阶段完成复杂
 * 任务是合法的多次调用，会被误杀；而反复重写同一段脚本，5 次以内它根本拦不住。
 *
 * 更贵的是模型知道有上限之后会为了省次数反复琢磨怎么一次写完——思考的 token 远比多调一次
 * 贵。实测三维场景一次运行因此烧掉 46 轮、77 万 token，最终 0 个 Effect。
 *
 * 「原地打转」由事实判：同签名重复调用、无新进展、连续失败、token 与回合预算。
 * 那些判据不会误伤真正有进展的第二段脚本。
 */
describe('run_henji_script 的调用预算', () => {
  it('不设次数上限', () => {
    expect(runHenjiScriptCapability.maxCallsPerRun).toBeUndefined()
  })

  // 计数回调是上限机制的一部分，上限没了它也不该留着——留着会误导下一个读代码的人。
  it('不保留计数回调', () => {
    expect(runHenjiScriptCapability.countsTowardCallLimit).toBeUndefined()
  })

  // 上限撤掉之后，每次调用仍然要完整经过网关：权限、审批、revision 一个都不能少。
  it('仍然是需要审批与 revision 校验的写入能力', () => {
    expect(runHenjiScriptCapability.readOnly).toBe(false)
    expect(runHenjiScriptCapability.permission).toBe('application:script:execute')
    expect(runHenjiScriptCapability.supportsPreview).toBe(true)
  })
})
