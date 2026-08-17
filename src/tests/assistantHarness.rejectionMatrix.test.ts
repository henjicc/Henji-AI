// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import type { ApplicationMutationExecutor } from '@/core/application-control'

import { runAssistantHarness, type HarnessToolCall } from './assistantRuntimeHarness'

/**
 * 拒绝字典的**全域穷举版**：每个有写入执行器的域都跑一遍同样的坏输入。
 *
 * 手写几条守的是"我想到的那几个域拒绝得体面"，可拒绝质量是注册数据与投影的函数——
 * 新增一个域、改一次投影裁剪，都可能让某个域的拒绝退化成一个光秃秃的错误码。而这类退化
 * 此前只能靠真机跑撞上，代价从多烧一轮到整次运行报废不等（实测一次改设置：5 回合 3.8 万
 * token → 18 回合 25 万）。
 *
 * 域清单从**真实反射注册表**推导，不手写：新增写域会自动进入遍历，漏建拒绝质量就当场变红。
 */

/** 有 mutation/collection 执行器的域——写域才谈得上"写错了怎么办"。 */
function writableDomains(): string[] {
  const registry = getApplicationReflectionRegistry()
  const engine = getApplicationControlExecutionEngine() as unknown as {
    mutationExecutors: Map<string, ApplicationMutationExecutor>
    collectionExecutors: Map<string, unknown>
  }
  const entityTypes = new Set([
    ...engine.mutationExecutors.keys(),
    ...engine.collectionExecutors.keys(),
  ])
  const description = registry.describe({}, {
    exposure: 'assistant',
    permissions: new Set(registry.listDeclaredPropertyPermissions()),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
  })
  return [...new Set(
    description.entities
      .filter((entity) => entityTypes.has(entity.id))
      .map((entity) => entity.domain)
  )].sort()
}

/** 该域第一个有写入执行器的实体类型，用来构造"属性写错"这一档。 */
function firstWritableEntityType(domain: string): string | null {
  const registry = getApplicationReflectionRegistry()
  const engine = getApplicationControlExecutionEngine() as unknown as {
    mutationExecutors: Map<string, ApplicationMutationExecutor>
    collectionExecutors: Map<string, unknown>
  }
  const entityTypes = new Set([
    ...engine.mutationExecutors.keys(),
    ...engine.collectionExecutors.keys(),
  ])
  const description = registry.describe({}, {
    exposure: 'assistant',
    permissions: new Set(registry.listDeclaredPropertyPermissions()),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
  })
  return description.entities
    .find((entity) => entity.domain === domain && entityTypes.has(entity.id))?.id ?? null
}

async function scriptRejection(input: {
  goal: string
  domain: string
  entityTypes: string[]
  source: string
}): Promise<{ rejection: HarnessToolCall | undefined; discoveryOk: boolean; runError: string | null }> {
  const result = await runAssistantHarness({
    goal: input.goal,
    steps: [
      {
        actions: [{
          type: 'tool_call',
          toolCall: {
            toolCallId: 'call-discover',
            toolName: 'discover_application_capabilities',
            input: {
              queries: [`${input.domain} 域写入`],
              domains: [input.domain],
              entityTypes: input.entityTypes,
              writes: true,
            },
            dynamic: false,
          },
        }],
      },
      {
        actions: [{
          type: 'tool_call',
          toolCall: {
            toolCallId: 'call-script',
            toolName: 'run_henji_script',
            input: { language: 'henji-ts/v1', summary: input.goal, source: input.source },
            dynamic: false,
          },
        }],
      },
      { actions: [{ type: 'text', value: '结束。' }] },
    ],
  })
  const discovery = result.toolCalls.find(
    (call) => call.toolName === 'discover_application_capabilities'
  )
  return {
    discoveryOk: discovery?.ok === true,
    rejection: result.toolCalls.find((call) => call.toolName === 'run_henji_script' && !call.ok),
    /*
     * 运行级失败要单独带出来。
     *
     * 拒绝的**正常**形态是一条 ToolFailed；但实测 camera_stage 曾经是整次 RunFailed——
     * 拒绝消息太长撑爆了工作摘要的 schema，构造失败记录时自己抛了异常，连 ToolFailed
     * 都没发出来。只看工具失败会把那种情况误报成"竟然没有被拒绝"，把真正的根因盖住。
     */
    runError: result.state.status === 'failed'
      ? `${result.state.error?.code ?? ''} ${result.state.error?.message ?? ''}`.trim()
      : null,
  }
}

describe('拒绝质量的全域穷举', () => {
  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  it('遍历规模符合预期，否则下面的断言会假绿', () => {
    const domains = writableDomains()
    // 防空转：写域数量塌到这个数以下说明注册链路本身出问题了。
    expect(domains.length, `实际写域：${domains.join('、')}`).toBeGreaterThanOrEqual(5)
    for (const domain of domains) {
      expect(firstWritableEntityType(domain), `${domain} 推导不出可写实体`).toBeTruthy()
    }
  })

  /*
   * 逐域跑同一组坏输入。用 `it` 里再遍历而不是 `it.each`，是因为每个域都要先真跑一次发现，
   * 分成独立用例会把 harness 启动成本乘以域数——合成一条之后全域仍在秒级。
   */
  it('每个写域：实体类型写错时都列出该域真实存在的实体', async () => {
    const failures: string[] = []
    for (const domain of writableDomains()) {
      const entityType = firstWritableEntityType(domain)
      if (!entityType) continue
      const { discoveryOk, rejection, runError } = await scriptRejection({
        goal: `${domain} 实体类型写错`,
        domain,
        entityTypes: [entityType],
        source: `await app.entities.update({ kind: '${entityType}__nope', id: 'x' }, { 'a.b': 1 });`,
      })
      if (!discoveryOk) { failures.push(`${domain}：能力发现本身失败，拒绝质量无从谈起`); continue }
      if (runError) {
        failures.push(`${domain}：拒绝把整次运行打死了（应当是一条可自纠的 ToolFailed）→ ${runError.slice(0, 160)}`)
        continue
      }
      const message = rejection?.errorMessage ?? ''
      if (!rejection) { failures.push(`${domain}：写错实体类型竟然没有被拒绝`); continue }
      if (!message.includes(`${entityType}__nope`)) {
        failures.push(`${domain}：拒绝没点名模型写错的那个实体 → ${message.slice(0, 120)}`)
      }
      if (!message.includes(entityType)) {
        failures.push(`${domain}：拒绝没列出真实存在的实体，模型只能继续猜 → ${message.slice(0, 120)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 60_000)

  it('每个写域：属性写错时都列出这个实体真实可用的属性', async () => {
    const failures: string[] = []
    for (const domain of writableDomains()) {
      const entityType = firstWritableEntityType(domain)
      if (!entityType) continue
      const { discoveryOk, rejection, runError } = await scriptRejection({
        goal: `${domain} 属性写错`,
        domain,
        entityTypes: [entityType],
        source: `await app.entities.update({ kind: '${entityType}', id: 'x' }, { '${entityType}.__definitely_not_a_property': 1 });`,
      })
      if (!discoveryOk) { failures.push(`${domain}：能力发现本身失败`); continue }
      if (runError) {
        failures.push(`${domain}：拒绝把整次运行打死了（应当是一条可自纠的 ToolFailed）→ ${runError.slice(0, 160)}`)
        continue
      }
      if (!rejection) { failures.push(`${domain}：写错属性竟然没有被拒绝`); continue }
      const message = rejection.errorMessage ?? ''
      if (!message.includes('__definitely_not_a_property')) {
        failures.push(`${domain}：拒绝没点名写错的属性 → ${message.slice(0, 120)}`)
      }
      /*
       * 只要求"给出了可用清单或明确的改道指引"，不要求清单完整——完整性由反射注册表自己的
       * 测试守。这里守的是**拒绝有没有把运行时已经知道的事实交出来**。
       */
      const hasGuidance = /可用的属性|可用的实体|重新调用 discover_application_capabilities/.test(message)
      if (!hasGuidance) {
        failures.push(`${domain}：拒绝是个死胡同，既没给可用清单也没指出改道方式 → ${message.slice(0, 160)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 60_000)
})
