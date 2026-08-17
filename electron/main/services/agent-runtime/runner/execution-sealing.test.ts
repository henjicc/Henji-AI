import { describe, expect, it } from 'vitest'

import type { AgentEffectKind, AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import { sealingSummary } from './execution-sealing'

function effect(kind: AgentEffectKind, verified = false): AgentObservedEffect {
  return {
    effect: kind, entityTypes: [], propertyIds: [], targetRefs: [],
    count: 1, verified, evidence: [`${kind}:fixture`],
  }
}

/**
 * 封存摘要是**用户唯一会读到的那句结论**，所以它说错的代价直接落在用户身上。
 * 这句话已经踩过两个方向相反的坑，两条都钉在这里。
 */
describe('封存摘要', () => {
  it('纯只读运行不得被说成应用写入', () => {
    /*
     * 坑一：曾经把 effects 整体称作"应用写入"，而它包含 observe。实测一次只读的工具箱查询
     * （8 段脚本全是 entities.read / entities.list）被报成"已完成 14 项应用写入"。
     */
    const summary = sealingSummary([effect('observe'), effect('observe'), effect('navigate')])
    expect(summary).not.toMatch(/已完成 [1-9]\d* 项应用写入/)
    expect(summary).toContain('没有产生应用写入')
    expect(summary).toContain('3 项读取或导航观察')
  })

  it('只把 create/update/delete/execute 计入写入', () => {
    const summary = sealingSummary([
      effect('observe'), effect('create'), effect('navigate'),
      effect('update'), effect('delete'), effect('execute'),
    ])
    expect(summary).toContain('已完成 4 项应用写入')
    expect(summary).toContain('2 项读取或导航观察')
  })

  it('不报只能取一个值的数字', () => {
    /*
     * 坑二：修完坑一后一度改成"其中 N 项有正式状态源读回证据"，只数写入里 verified 为真的。
     * 但 verified 完全由能力静态声明、运行时没有任何地方会把它翻成 true，而全部 14 处写入类
     * Effect 声明里 verified: true 的有 0 处——读能力才声明 true（读本身就是验证）。
     * 于是那个数只能是 0，四个真机场景全报"其中 0 项有读回证据"，看着像验证坏了，
     * 实际什么信息都没有。一个只能取一个值的数字不是证据，是噪音。
     *
     * 这条用"写入 verified 全 false"和"全 true"两种输入产出同一句话来钉死它：
     * 摘要不得再对写入的 verified 位做任何声称。
     */
    const allFalse = sealingSummary([effect('create'), effect('update'), effect('observe')])
    const allTrue = sealingSummary([
      effect('create', true), effect('update', true), effect('observe', true),
    ])
    expect(allFalse).toBe(allTrue)
    expect(allFalse).not.toContain('读回证据')
  })

  it('有写入却一次都没读回时，明说结果未经确认', () => {
    /*
     * 这才是真正有信息量的那件事：写了但没验。坑二那个恒为 0 的数字把它盖住了。
     */
    const summary = sealingSummary([effect('create'), effect('update')])
    expect(summary).toContain('已完成 2 项应用写入')
    expect(summary).toContain('未经读回确认')
  })

  it('什么都没发生时不编造数字', () => {
    expect(sealingSummary([])).toBe('本次没有产生应用写入。')
  })
})
