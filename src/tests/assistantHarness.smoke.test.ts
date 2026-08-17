// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import {
  assertHarnessWiring,
  buildAssistantHarnessRuntime,
  runAssistantHarness,
} from './assistantRuntimeHarness'

/**
 * harness 的自测：**先证明这一层不是空转，再拿它去测别的东西。**
 *
 * 一个把业务判断悄悄搬进替身的 harness 会一路绿灯，而它绿的时候恰恰是最该红的时候。
 * 所以这里先钉住三件事：注册链路是真的、渲染层执行器真的接上了、模型确实按剧本被调用。
 */
describe('助手剧本 harness 自测', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('接的是真实注册表：工具数、前端能力数与脚本内核都达标', () => {
    const { registry } = buildAssistantHarnessRuntime({ goal: '自测', steps: [] })
    expect(() => assertHarnessWiring(registry)).not.toThrow()

    const definitions = registry.allDefinitions()
    expect(definitions.length).toBeGreaterThan(60)
    expect(definitions.filter((definition) => definition.side === 'frontend').length)
      .toBeGreaterThan(40)
    expect(definitions.map((definition) => definition.name)).toContain('run_henji_script')
    // 通用动词必须在场：它们是反射写入的唯一入口，缺了等于整条写链路没接。
    expect(definitions.map((definition) => definition.name))
      .toEqual(expect.arrayContaining([
        'describe_application_entities',
        'change_application_entities',
        'read_application_entity',
      ]))
  })

  it('宿主快照来自真实渲染层，不是硬编码的假快照', () => {
    const { getHostContext } = buildAssistantHarnessRuntime({ goal: '自测', steps: [] })
    const snapshot = getHostContext()

    expect(snapshot.rendererSessionId).toBeTruthy()
    expect(snapshot.availableCapabilities?.length ?? 0).toBeGreaterThan(40)
    // catalogRevision 由能力目录求和而来，假快照写不出这个数。
    expect(snapshot.catalogRevision ?? 0).toBeGreaterThan(0)
    expect(snapshot.scopeRevisions).toHaveProperty('canvas')
  })

  it('纯文本剧本能把运行带到终态，且模型确实按剧本被调用', async () => {
    const result = await runAssistantHarness({
      goal: '只回答一句话，不要操作应用。',
      steps: [{ actions: [{ type: 'text', value: '好的，我不做任何操作。' }] }],
    })

    expect(result.state.status, JSON.stringify(result.state.error)).toBe('completed')
    expect(result.modelSteps).toBe(1)
    expect(result.offloaded).toBe(false)
    expect(result.events.some((event) => event.type === 'PlanUpdated')).toBe(true)
  })

  it('剧本里的读工具真的穿过 Gateway 打到渲染层执行器', async () => {
    const result = await runAssistantHarness({
      goal: '读取当前应用上下文。',
      intent: 'general',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-context',
              toolName: 'get_current_application_context',
              input: {},
              dynamic: false,
            },
          }],
        },
        { actions: [{ type: 'text', value: '已读取当前上下文。' }] },
      ],
    })

    expect(result.state.status, JSON.stringify(result.state.error)).toBe('completed')
    const call = result.toolCalls.find((item) => item.toolName === 'get_current_application_context')
    expect(call, `实际工具调用：${JSON.stringify(result.toolCalls)}`).toBeDefined()
    expect(call?.ok, `${call?.errorCode}: ${call?.errorMessage}`).toBe(true)
  })

  it('调用未发现的工具会被真实 Gateway 拒绝，而不是被 harness 放行', async () => {
    /*
     * 这条守的是 harness 没有绕过准入。剧本可以写任何工具名，真运行时必须照样按租约和
     * 活动工具集拒绝——不然这一层测出来的"能跑通"全是假的。
     */
    const result = await runAssistantHarness({
      goal: '调用一个不存在的工具。',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-ghost',
              toolName: 'definitely_not_a_registered_tool',
              input: {},
              dynamic: false,
            },
          }],
        },
        { actions: [{ type: 'text', value: '那条路走不通。' }] },
      ],
    })

    const failed = result.toolCalls.find(
      (item) => item.toolName === 'definitely_not_a_registered_tool'
    )
    expect(failed, `实际工具调用：${JSON.stringify(result.toolCalls)}`).toBeDefined()
    expect(failed?.ok).toBe(false)
  })
})
