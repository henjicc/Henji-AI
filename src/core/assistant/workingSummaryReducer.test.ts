import { describe, expect, it } from 'vitest'

import type { AgentEvent } from './events'
import { reduceAgentWorkingSummary } from './workingSummaryReducer'
import {
  AGENT_WORKING_STEP_SUMMARY_MAX,
  agentWorkingSummarySchema,
  createAgentWorkingSummary,
} from './workingContext'

const at = '2026-08-18T00:00:00.000Z'

/** 事件的公共外壳。逐字段写全，不要用 `as` 把缺字段掩过去——缺的那个字段可能正是被测行为。 */
function envelope(sequence: number) {
  return {
    schemaVersion: 'agent-event/v2' as const,
    eventId: `event-${sequence}`,
    runId: 'r',
    threadId: 't',
    sequence,
    occurredAt: at,
  }
}

function requested(toolName: string, sequence = 1): AgentEvent {
  return {
    ...envelope(sequence),
    type: 'ToolRequested',
    toolCallId: `call-${sequence}`,
    toolName,
    inputDigest: 'sha256:x',
    readOnly: false,
  }
}

function failed(toolName: string, message: string, sequence = 2): AgentEvent {
  return {
    ...envelope(sequence),
    type: 'ToolFailed',
    toolCallId: `call-${sequence - 1}`,
    toolName,
    error: { code: 'SCRIPT_API_NOT_DISCOVERED', message, retryable: false, recovery: 'none' },
  }
}

function completed(toolName: string, summary: string, sequence = 2): AgentEvent {
  return {
    ...envelope(sequence),
    type: 'ToolCompleted',
    toolCallId: `call-${sequence - 1}`,
    toolName,
    summary,
  }
}

const revisions = {
  navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0, settings: 0, surface: 0,
}

function reduceAll(events: AgentEvent[]) {
  return events.reduce(
    (summary, event) => reduceAgentWorkingSummary(summary, event, revisions),
    createAgentWorkingSummary('目标')
  )
}

/**
 * 工作摘要的构造**不能自己把运行打死**。
 *
 * 这条守的是一次实测硬伤：`failActiveStep` 直接拼 `${code}: ${message}` 不截断，而拒绝消息
 * 为了"能被自我修正"要列出该实体全部可用属性——三维场景光外观就 24 项，拼出来超过 schema
 * 允许的 1000 字符，于是构造失败记录这一步自己抛 ZodError，一次本该可自纠的工具拒绝变成
 * 整次运行 RunFailed，连 ToolFailed 事件都没发出来。比原来那句光秃秃的错误码还糟。
 *
 * 成功路径同一形状：ToolCompleted.summary 允许 2000 字符，步骤只允许 1000。
 */
describe('工作摘要的长文本边界', () => {
  it('超长拒绝消息不会让构造抛异常，且结果通过 schema 校验', () => {
    const longMessage = `属性 x 未在本次 scriptApi 租约中披露。本次租约可用的属性：${
      Array.from({ length: 120 }, (_, index) => `camera_stage.object.property_${index}`).join('、')
    }。确实需要别的，就重新调用 discover_application_capabilities。`
    expect(longMessage.length).toBeGreaterThan(AGENT_WORKING_STEP_SUMMARY_MAX)

    const summary = reduceAll([requested('run_henji_script'), failed('run_henji_script', longMessage)])
    expect(() => agentWorkingSummarySchema.parse(summary)).not.toThrow()
    expect(summary.failedSteps).toHaveLength(1)
    expect(summary.failedSteps[0].summary.length).toBeLessThanOrEqual(AGENT_WORKING_STEP_SUMMARY_MAX)
  })

  it('截断保住两端：开头的错误码与结尾的改道指引都还在', () => {
    /*
     * 砍尾巴等于把出路砍掉——模型拿到半句话只会继续撞墙，那正是"拒绝要给改道"这条规则
     * 最初要解决的问题。所以省略中间的枚举，两端必须留住。
     */
    const longMessage = `属性 x 未在本次 scriptApi 租约中披露。可用的属性：${
      Array.from({ length: 120 }, (_, index) => `prop_${index}`).join('、')
    }。确实需要别的，就重新调用 discover_application_capabilities。`
    const summary = reduceAll([requested('run_henji_script'), failed('run_henji_script', longMessage)])
    const text = summary.failedSteps[0].summary

    expect(text, '开头必须留住错误码').toContain('SCRIPT_API_NOT_DISCOVERED')
    expect(text, '结尾必须留住改道指引').toContain('discover_application_capabilities')
    expect(text, '中间被省略要说明白').toContain('略去')
  })

  it('成功步骤的超长摘要同样被截断，不会打死运行', () => {
    const summary = reduceAll([
      requested('some_tool'),
      completed('some_tool', 'x'.repeat(AGENT_WORKING_STEP_SUMMARY_MAX + 500)),
    ])
    expect(() => agentWorkingSummarySchema.parse(summary)).not.toThrow()
    expect(summary.completedSteps[0].summary.length)
      .toBeLessThanOrEqual(AGENT_WORKING_STEP_SUMMARY_MAX)
  })

  it('没超长时原样保留，不做无谓改写', () => {
    const summary = reduceAll([requested('some_tool'), completed('some_tool', '一切正常。')])
    expect(summary.completedSteps[0].summary).toBe('一切正常。')
  })

  it('任何一条携带长文本的事件都不得让构造抛异常', () => {
    /*
     * 同一形状的溢出已经在三个不同字段上各出现一次：`failedSteps[].summary`、
     * `completedSteps[].summary`、`evidence[].summary`。逐个补是打补丁，所以这里改成穷举——
     * 把每种带自由文本的事件都用一段超长文本喂一遍，任意一处忘了截断就当场变红。
     *
     * 这类缺陷的代价特别高：抛出点在构造工作摘要的路径上，异常直接变成整次运行 RunFailed，
     * 连 `ToolFailed` 事件都发不出去，日志里只剩一段 ZodError，看不出是哪个工具、哪句话撑爆的。
     */
    const long = 'x'.repeat(4_000)
    const events: AgentEvent[] = [
      requested('tool_a', 1),
      completed('tool_a', long, 2),
      requested('tool_b', 3),
      failed('tool_b', long, 4),
      {
        ...envelope(5),
        type: 'ClarificationRequired',
        waitId: 'w',
        question: long.slice(0, 900),
        reason: long.slice(0, 400),
      },
    ]

    for (let count = 1; count <= events.length; count += 1) {
      const slice = events.slice(0, count)
      expect(
        () => agentWorkingSummarySchema.parse(reduceAll(slice)),
        `前 ${count} 条事件（末条 ${slice[count - 1].type}）构造出的工作摘要过不了自身 schema`,
      ).not.toThrow()
    }
  })
})
