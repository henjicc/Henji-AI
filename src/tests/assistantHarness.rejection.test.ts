// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import { runAssistantHarness, type HarnessToolCall } from './assistantRuntimeHarness'

/**
 * 拒绝字典：**每一条拒绝都必须让模型知道下一步能做什么。**
 *
 * 这一整类缺陷此前只能靠真机跑发现，代价从多烧一轮到整次运行报废不等（实测一次改设置
 * 5 回合 3.8 万 token → 18 回合 25 万）。但它们本质上是确定性的：给一个错的输入，看回来的
 * 那句话里有没有运行时**已经知道**的事实。剧本驱动真运行时就能秒级穷举。
 *
 * 判据不是"有没有拒绝"，而是"拒绝里有没有改道信息"：
 *   - 实体类型写错 → 必须列出本轮租约里真实可用的实体
 *   - 属性写错 → 必须列出这个实体真实可用的属性
 *   - 容量/深度超限 → 必须给出撞的是哪条线、实际多少、上限多少、哪个字段
 * 只给一个错误码等于让模型继续猜，而它猜不中就是死循环。
 */

const DISCOVER = (domain: string, entityTypes: string[]) => ({
  actions: [{
    type: 'tool_call' as const,
    toolCall: {
      toolCallId: 'call-discover',
      toolName: 'discover_application_capabilities',
      input: { queries: [`${domain} 域读写`], domains: [domain], entityTypes, writes: true },
      dynamic: false,
    },
  }],
})

const SCRIPT = (summary: string, source: string) => ({
  actions: [{
    type: 'tool_call' as const,
    toolCall: {
      toolCallId: 'call-script',
      toolName: 'run_henji_script',
      input: { language: 'henji-ts/v1', summary, source },
      dynamic: false,
    },
  }],
})

const CLOSE = { actions: [{ type: 'text' as const, value: '结束。' }] }

async function rejectionOf(input: {
  goal: string
  domain: string
  entityTypes: string[]
  source: string
}): Promise<HarnessToolCall> {
  const result = await runAssistantHarness({
    goal: input.goal,
    steps: [DISCOVER(input.domain, input.entityTypes), SCRIPT(input.goal, input.source), CLOSE],
  })
  const discovery = result.toolCalls.find(
    (call) => call.toolName === 'discover_application_capabilities'
  )
  expect(
    discovery?.ok,
    `发现步骤本身失败了，后面的拒绝断言就没有意义：${discovery?.errorCode} ${discovery?.errorMessage}`,
  ).toBe(true)

  const rejection = result.toolCalls.find((call) => call.toolName === 'run_henji_script' && !call.ok)
  expect(
    rejection,
    `预期脚本被拒绝，实际工具调用：${JSON.stringify(result.toolCalls)}`,
  ).toBeDefined()
  return rejection as HarnessToolCall
}

describe('拒绝必须能被自我修正', () => {
  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  it('实体类型写错时，列出本轮真实可用的实体', async () => {
    const rejection = await rejectionOf({
      goal: '实体类型写错',
      domain: 'settings',
      entityTypes: ['settings.registry'],
      source: "await app.entities.update({ kind: 'settings.preference', id: 'singleton' }, { 'general.language': 'zh-CN' });",
    })

    const message = rejection.errorMessage ?? ''
    expect(message, '拒绝里必须点名模型写错的那个实体').toContain('settings.preference')
    expect(
      message,
      '拒绝里必须列出真实存在的实体，否则模型只能继续猜——而它猜不中就是死循环。',
    ).toContain('settings.registry')
  })

  it('属性写错时，列出这个实体真实可用的属性', async () => {
    const rejection = await rejectionOf({
      goal: '属性写错',
      domain: 'settings',
      entityTypes: ['settings.registry'],
      source: "await app.entities.update({ kind: 'settings.registry', id: 'singleton' }, { 'general.not_a_real_setting': 'x' });",
    })

    const message = rejection.errorMessage ?? ''
    expect(message).toContain('general.not_a_real_setting')
    /*
     * 这里断言的是"清单里有真东西"，不是"清单完整"。
     * 完整性由反射注册表自己的测试守；这条守的是**拒绝有没有把已知事实交出来**。
     */
    expect(message, '拒绝里必须列出真实属性').toContain('general.language')
    expect(message, '拒绝里必须列出真实属性').toContain('interface.theme_tone')
  })

  it('未发现的领域动作被调用时，指出该重新发现', async () => {
    const rejection = await rejectionOf({
      goal: '调用未发现的动作',
      domain: 'settings',
      entityTypes: ['settings.registry'],
      source: "await app.action('create_canvas_project', { name: 'x' });",
    })

    const message = rejection.errorMessage ?? ''
    expect(message).toContain('create_canvas_project')
    expect(
      message,
      '拒绝必须指出改道方式（重新发现），否则模型会以为应用没有这个能力。',
    ).toContain('discover_application_capabilities')
  })
})

/**
 * 超限拒绝单独一组：它撞的是 Gateway 的安全限制，不经过脚本租约。
 *
 * 这一条来自试点实测——`image_edit` 域的能力发现曾经**每次都失败**，因为
 * `create_image_edit_preview` 的入参是判别联合套判别联合，投影后 17 层超过默认上限 16，
 * 而拒绝只说一句"工具参数或预览超过安全限制"：不说哪条线、不说实际多少、不说哪个字段。
 * 模型只能拿同一份载荷整段重试，而重试必然再次超限。
 */
describe('超限拒绝必须说清撞的是哪条线', () => {
  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  it('image_edit 域的能力发现能正常返回，不再被深度限制打死', async () => {
    const result = await runAssistantHarness({
      goal: '发现图片编辑能力',
      intent: 'image_edit',
      steps: [
        DISCOVER('image_edit', ['image_edit.session', 'image_edit.document']),
        { actions: [{ type: 'text', value: '已拿到图片编辑能力目录。' }] },
      ],
    })

    const discovery = result.toolCalls.find(
      (call) => call.toolName === 'discover_application_capabilities'
    )
    expect(
      discovery?.ok,
      `image_edit 发现失败：${discovery?.errorCode} ${discovery?.errorMessage}。`
      + '该域的能力注册齐全，发现却抛异常，等于整个域对模型不存在。',
    ).toBe(true)
    expect(discovery?.summary ?? '').toMatch(/返回 \d+ 项能力/)
    expect(result.state.status, JSON.stringify(result.state.error)).toBe('completed')
  })

  it('输入超限时，拒绝里带上限制名、实际值、上限与字段路径', async () => {
    /*
     * 用一个超长字符串撞 TOOL_INPUT_LIMITS.maxStringLength（32KiB）。
     * 断言的不是"被拒了"，而是拒绝里有没有让模型能据此缩短的信息。
     */
    const oversized = 'x'.repeat(40 * 1024)
    const result = await runAssistantHarness({
      goal: '输入超限',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-oversized',
              toolName: 'run_henji_script',
              input: { language: 'henji-ts/v1', summary: oversized, source: 'await app.entities.list("settings.registry");' },
              dynamic: false,
            },
          }],
        },
        CLOSE,
      ],
    })

    const rejection = result.toolCalls.find((call) => !call.ok)
    expect(rejection, `预期被拒绝：${JSON.stringify(result.toolCalls)}`).toBeDefined()
    const message = rejection?.errorMessage ?? ''
    expect(message, '必须点名撞的是哪条限制').toMatch(/JSON_[A-Z_]+/)
    expect(message, '必须给出实际值与上限，否则模型不知道该砍到多少').toMatch(/\d+/)
    expect(message, '必须给出字段路径，否则模型不知道该缩短哪一个字段').toContain('位置')
  })
})
