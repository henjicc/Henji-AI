import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import {
  runHenjiScriptCapability,
  runHenjiScriptOutputSchema,
} from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import type { ModelStepToolCall } from '@henjicc/ai-sdk'
import { toolMessage } from '../runner/runner-results'
import { buildAgentContextLayers } from './prompt-layers'
import { skillBuildInput } from './context-test-fixtures'
import {
  AgentArtifactStore,
  resolveToolOffloadByteThreshold,
  shouldOffloadObservation,
} from './offload'
import type { AgentContextBuildInput } from './types'

/*
 * 回归：同一份工具结果在 tool 消息里被内联、在观察层却被卸载成 artifact。
 *
 * 两处都调 shouldOffloadObservation，但量的东西不同——toolMessage 量 projectForHistory
 * 之后的体积，观察层量的是原始 output。于是模型在 tool 消息里已经拿到完整内容，观察层又
 * 递给它一个 artifactRef，它就老老实实去分页读回一份自己已经有的东西。实测一次运行
 * 18 次 read_agent_artifact、25 个模型步不收敛。
 *
 * prompt-layers 里那行注释本来就写着"必须和 runner-results.toolMessage 用同一把尺子"——
 * 上次修补的是 contextWindow，漏了投影这一半。
 */
const CONTEXT_WINDOW = 64_000

/** 原始体积远超阈值、投影后只剩一点点——正是能力发现结果的形状。 */
function bulkyOutput(): Record<string, unknown> {
  return {
    summary: '能力发现结果',
    bulk: Array.from({ length: 400 }, (_, index) => ({
      name: `capability_${index}`,
      inputSchema: { type: 'object', properties: { value: { type: 'string', description: '描'.repeat(40) } } },
    })),
    keep: 'ok',
  }
}

function project(output: unknown): unknown {
  const record = output as Record<string, unknown>
  return { summary: record.summary, keep: record.keep }
}

function observation(): AgentToolObservation {
  return {
    source: { toolName: 'discover_application_capabilities', toolVersion: 1, toolCallId: 'call-1' },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: '发现完成',
    output: bulkyOutput(),
  }
}

/**
 * 观察层里这条结果是否真的被卸载了。
 *
 * 不能对整层内容做 `includes('artifactRef')`——该层开头的固定说明文字里就带着这个词，
 * 那样无论有没有卸载都恒为真。判据只看这条记录本身有没有 artifactRef 字段。
 */
function offloadedInObservationLayer(
  resolveHistoryProjection?: (toolName: string) => ((output: unknown) => unknown) | undefined
): boolean {
  return observationWasOffloaded(observation(), resolveHistoryProjection)
}

function observationWasOffloaded(
  currentObservation: AgentToolObservation,
  resolveHistoryProjection?: (toolName: string) => ((output: unknown) => unknown) | undefined
): boolean {
  const input: AgentContextBuildInput = {
    ...skillBuildInput(undefined),
    contextWindowBudget: CONTEXT_WINDOW,
    observations: [currentObservation],
    conversation: [],
    resolveHistoryProjection,
  }
  const { layers } = buildAgentContextLayers(input, [], new AgentArtifactStore())
  const content = layers.find((layer) => layer.id === 'observations')?.content ?? ''
  return content
    .split('\n')
    .filter((line) => line.includes('"toolCallId"'))
    .some((line) => line.includes('"artifactRef"'))
}

describe('卸载判定的同一把尺子', () => {
  const call: ModelStepToolCall = {
    toolCallId: 'call-1', toolName: 'discover_application_capabilities', input: {}, dynamic: false,
  }

  it('tool 消息内联时观察层不得卸载成 artifact', () => {
    const message = toolMessage(call, observation(), CONTEXT_WINDOW, () => project)
    expect(
      JSON.stringify(message).includes('largeResultOmitted'),
      'tool 消息应当内联：投影后体积很小',
    ).toBe(false)

    expect(
      offloadedInObservationLayer(() => project),
      '观察层不该卸载：tool 消息已内联同一份内容，再给 artifactRef 会让模型去读它已经有的东西。',
    ).toBe(false)
  })

  it('没有投影函数时两处一致地卸载', () => {
    const message = toolMessage(call, observation(), CONTEXT_WINDOW)
    expect(JSON.stringify(message)).toContain('largeResultOmitted')
    expect(offloadedInObservationLayer()).toBe(true)
  })
})

/*
 * 回归：读 artifact 的结果又被卸载成新 artifact，无限套娃。
 *
 * 分页上限 32KB、卸载阈值最低 8KB，所以读回来的一页必然超阈值。模型读 A 拿到页 B，
 * B 被卸载成 C……而页的顶层字段是 schemaVersion/content/nextCursor 那一套，跟它想读的
 * 内容完全不同形状。实测 camera 场景因此 31 轮 0 个 Effect。
 */
describe('分页结果不再被卸载', () => {
  const page = {
    schemaVersion: 'agent-artifact/v1',
    artifactRef: 'artifact:a',
    source: 'discover_application_capabilities',
    dataClasses: ['C1'],
    contentEncoding: 'json-fragment',
    content: 'x'.repeat(30_000),
    returnedBytes: 30_000,
    totalBytes: 90_000,
    nextCursor: 'v1:30000:abcdef0123456789',
    hasMore: true,
    selectedFields: [],
    missingFields: [],
  }

  it('远超阈值的分页结果也不卸载', () => {
    expect(shouldOffloadObservation(page, 8 * 1024)).toBe(false)
  })

  it('形状相近但不是分页结果的照常卸载', () => {
    const notPage = { ...page, contentEncoding: 'text/plain' }
    expect(shouldOffloadObservation(notPage, 8 * 1024)).toBe(true)
  })
})

/*
 * 回归：模型必然要全量看的结果被推去分页，纯亏回合数。
 *
 * 实测 camera 场景 66KB 的发现结果被卸载，模型用 3 个回合把它一字不落读回来
 * （32768+32768+12550＝原始大小），三页照样全留在上下文里——卸载一个字节没省，
 * 只换来 3 个回合的净损失。发现结果不是"可以扫一眼的观察"，是写任何脚本都必须
 * 完整持有的 scriptApi 契约。
 */
describe('按工具的内联下限', () => {
  const window = 64_000

  it('Henji Script 的完整回执留在当轮，不卸载后再让模型回读', () => {
    const stepCount = 12
    const output = runHenjiScriptOutputSchema.parse({
      ok: true,
      status: 'completed',
      scriptRunRef: 'script:run-1',
      steps: Array.from({ length: stepCount }, (_, index) => ({
        stepId: `step_${index}`,
        api: 'entities.update',
        status: 'completed',
        location: { line: index + 1, column: 1 },
        resultRefs: [{ kind: 'canvas.node', id: `node-${index}` }],
        effectCount: 1,
        summary: `已更新节点 ${index}`,
      })),
      resultRefs: Array.from({ length: stepCount }, (_, index) => ({
        kind: 'canvas.node', id: `node-${index}`,
      })),
      effects: Array.from({ length: stepCount }, (_, index) => ({
        effect: 'update',
        entityTypes: ['canvas.node'],
        propertyIds: ['canvas.node.position'],
        targetRefs: [{ kind: 'canvas.node', id: `node-${index}` }],
        count: 1,
        verified: true,
        evidence: Array.from(
          { length: 8 },
          (_, evidenceIndex) => `step_${index}:read-back:${evidenceIndex}:${'验'.repeat(60)}`,
        ),
      })),
      verification: {
        passed: true,
        summary: '全部节点已从正式状态源读回验证。',
        evidence: ['formal-verification-sentinel'],
      },
      error: null,
      submittedTasks: [],
      checkpoint: null,
      revision: stepCount,
      scopeRevisions: { canvas: stepCount },
    })
    const project = (raw: unknown): unknown => runHenjiScriptCapability.projectForHistory?.(
      runHenjiScriptOutputSchema.parse(raw),
    )
    const projected = project(output)
    const generic = resolveToolOffloadByteThreshold('read_application_entity', window)
    expect(shouldOffloadObservation(projected, generic), '回执应确实超过通用门槛').toBe(true)

    const currentObservation: AgentToolObservation = {
      source: { toolName: 'run_henji_script', toolVersion: 1, toolCallId: 'script-call-1' },
      trust: 'untrusted_observation',
      dataClasses: ['C1'],
      summary: `Henji Script 已完成 ${stepCount} 个语义步骤并通过正式验证。`,
      output,
    }
    const call: ModelStepToolCall = {
      toolCallId: 'script-call-1', toolName: 'run_henji_script', input: {}, dynamic: false,
    }
    const message = toolMessage(call, currentObservation, window, () => project)

    expect(JSON.stringify(message)).toContain('formal-verification-sentinel')
    expect(JSON.stringify(message)).not.toContain('largeResultOmitted')
    expect(observationWasOffloaded(currentObservation, () => project)).toBe(false)
  })

  /*
   * camera 实测的三条载荷都必须内联：13 项能力约 55KB、20 项能力 66.4KB 与 71.8KB。
   * 下限曾是 64KiB，正好卡在中间——同一份代码连测三次走出两条路径，4 回合 / 6 回合 / 10 回合，
   * token 差三倍。判据要盯住实测过的最大那份，不能只覆盖典型值。
   */
  it('camera 实测过的三种发现结果体量都不分页', () => {
    const generic = resolveToolOffloadByteThreshold('read_application_entity', window)
    const discovery = resolveToolOffloadByteThreshold('discover_application_capabilities', window)
    expect(discovery).toBeGreaterThan(generic)

    for (const bytes of [55 * 1024, 66_406, 71_822]) {
      const payload = { data: 'x'.repeat(bytes) }
      expect(shouldOffloadObservation(payload, generic), `${bytes} 应超过通用门槛`).toBe(true)
      expect(shouldOffloadObservation(payload, discovery), `${bytes} 不该被推去分页`).toBe(false)
    }
  })

  /*
   * 下限只是下限：真的超大结果照旧分页——否则一次压缩就把整段历史冲掉。
   */
  it('超大结果照旧分页', () => {
    const huge = { data: 'x'.repeat(400 * 1024) }
    expect(shouldOffloadObservation(huge, resolveToolOffloadByteThreshold(
      'discover_application_capabilities', window,
    ))).toBe(true)
  })

  /*
   * 下限是按工具定的常量，不看窗口。小窗口模型上直接内联 128KB 会把上下文撑爆，
   * 那比分页糟得多——"必须整份看到"的诉求必须止步于物理可行的范围。
   */
  it('小预算下内联下限被预算本身压住', () => {
    const small = resolveToolOffloadByteThreshold('discover_application_capabilities', 16_000)
    expect(small).toBeLessThan(128 * 1024)
    // 1 token 约 2 字节，最多吃掉预算的 60%
    expect(small).toBeLessThanOrEqual(Math.floor(16_000 * 0.6 * 2))

    // 预算够大时下限完整生效
    expect(resolveToolOffloadByteThreshold('discover_application_capabilities', 200_000))
      .toBeGreaterThanOrEqual(128 * 1024)
  })

  /*
   * search_models 的 24KiB 下限原先只加在 toolMessage 里，观察层还用通用门槛——
   * 正是本文件开头那条"同一把尺子"警告过的形状，只是当时漏了按工具的下限这一半。
   */
  it('两处按工具解析门槛的函数是同一个', () => {
    const generic = resolveToolOffloadByteThreshold('read_application_entity', 16_000)
    const models = resolveToolOffloadByteThreshold('search_models', 16_000)
    expect(models).toBeGreaterThan(generic)
    // 下限同样受预算上限约束：16,000 token 的预算装不下 24KiB 的模型目录
    expect(models).toBe(Math.max(generic, Math.min(24 * 1024, Math.floor(16_000 * 0.6 * 2))))
  })
})
