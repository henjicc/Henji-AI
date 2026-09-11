// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { useSettingsStore } from '@/stores/settingsStore'
import { changeLanguage, getCurrentLanguage } from '@/utils/language'
import { useUiStore } from '@/stores/uiStore'
import { useNavigationStore, switchWorkspace } from '@/stores/navigationStore'
import { createHostContextSnapshot, retainHostContextTracking } from '@/features/assistant/hostContext/hostContext'

import { runAssistantHarness } from './assistantRuntimeHarness'

/**
 * 设置域的**读改验回环**：走完整链路把值写下去，再从真相源读回来对账。
 *
 * 与 `settingsReflectionResult.test.ts` 的分工：那条直接调 `applicationReflectionHandlers`，
 * 隔离验证反射适配器与领域执行器；这条从**模型的位置**出发，经能力发现 → 脚本租约 →
 * Henji Script 解释器 → Gateway（权限/revision/Effect Receipt）→ 反射适配器 → 执行器 →
 * zustand。两条守的是同一个业务事实，但中间那一大段只有这条覆盖得到。
 *
 * 断言一律读 zustand 真相源，不看 `completed`、不看 evidence——那是规则里明写的红线。
 */
describe('设置域的读改验回环', () => {
  let originalLanguage: ReturnType<typeof getCurrentLanguage>
  let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']
  let originalUi: ReturnType<typeof useUiStore.getState>
  let originalNavigation: ReturnType<typeof useNavigationStore.getState>

  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  beforeEach(() => {
    originalLanguage = getCurrentLanguage()
    originalTone = useSettingsStore.getState().themeTonePreset
    originalUi = useUiStore.getState()
    originalNavigation = useNavigationStore.getState()
    useUiStore.setState({ isSettingsOpen: false, settingsTarget: null })
  })

  afterEach(() => {
    changeLanguage(originalLanguage)
    useSettingsStore.getState().setThemeTonePreset(originalTone)
    useUiStore.setState(originalUi)
    useNavigationStore.setState(originalNavigation)
  })

  it.each([false, true])('修改结果默认自动展示；用户切页接管=%s 时遵循接管状态', async (takeover) => {
    const target = originalTone === 'warm' ? 'cool' : 'warm'
    const release = retainHostContextTracking()
    try {
      const result = await runAssistantHarness({
        goal: `把界面色调改成 ${target}`, intent: 'settings',
        getHostContext: () => createHostContextSnapshot(),
        onEvent: (event) => {
          if (takeover && event.type === 'ToolCompleted' && event.toolName === 'run_henji_script') {
            switchWorkspace(useNavigationStore.getState().activeWorkspace === 'tools' ? 'generation' : 'tools')
          }
        },
        steps: [
          { actions: [{ type: 'tool_call', toolCall: { toolCallId: 'discover', toolName: 'discover_application_capabilities', dynamic: false,
            input: { queries: ['界面色调'], domains: ['settings'], entityTypes: ['settings.registry'], writes: true } } }] },
          { actions: [{ type: 'tool_call', toolCall: { toolCallId: 'write', toolName: 'run_henji_script', dynamic: false,
            input: { language: 'henji-ts/v1', summary: '修改色调', source:
              `await app.entities.update({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_tone': '${target}' });` } } }] },
          { actions: [{ type: 'text', value: '已修改。' }] },
        ],
      })
      expect(result.state.status, JSON.stringify(result.state.presentationOutcome)).toBe('completed')
      expect(useSettingsStore.getState().themeTonePreset).toBe(target)
      expect(useUiStore.getState().isSettingsOpen, JSON.stringify({ outcome: result.state.executionOutcome, policy: result.state.workingSummary?.taskPolicy })).toBe(!takeover)
      expect(result.state.workingSummary?.taskPolicy?.navigationTakenOver).toBe(takeover)
    } finally { release() }
  })

  it('真实用户查询经过策略解释、发现及脚本预检，full_access 也不能把它变成写入', async () => {
    const goal = '只查询当前界面色调，不要修改任何设置，也不要切页。'
    const target = originalTone === 'warm' ? 'cool' : 'warm'
    const result = await runAssistantHarness({
      goal, intent: 'settings', approvalMode: 'full_access',
      // 替身位于语义模型输出边界，未向 lease 或 Gateway 注入禁止动作。
      policyInterpretation: { intent: 'read_only', forbiddenEffects: ['navigate'], navigationRequested: false, clarification: '' },
      steps: [
        { actions: [{ type: 'tool_call', toolCall: {
          toolCallId: 'discover-read', toolName: 'discover_application_capabilities', dynamic: false,
          input: { queries: ['界面色调'], domains: ['settings'], entityTypes: ['settings.registry'], writes: true },
        } }] },
        { actions: [{ type: 'tool_call', toolCall: {
          toolCallId: 'incorrect-write', toolName: 'run_henji_script', dynamic: false,
          input: { language: 'henji-ts/v1', summary: '误写设置', source:
            `await app.entities.update({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_tone': '${target}' });` },
        } }] },
        { actions: [{ type: 'text', value: '修改未执行。' }] },
      ],
    })
    expect(useSettingsStore.getState().themeTonePreset).toBe(originalTone)
    const policy = result.events.find((event) => event.type === 'TaskPolicyUpdated')
    expect(policy).toMatchObject({ policy: { intent: 'read_only', sources: [{ quote: goal }] } })
    expect(result.events.some((event) => event.type === 'ToolFailed'
      && event.toolName === 'run_henji_script' && event.error.message.includes('禁止')), JSON.stringify(result.toolCalls)).toBe(true)
    expect(result.state.executionOutcome?.effects ?? []).toEqual([])
  })

  it('一次脚本内改主题色调再读回验证，zustand 真相源随之变化', async () => {
    const target = originalTone === 'warm' ? 'cool' : 'warm'
    const result = await runAssistantHarness({
      goal: `把界面色调改成 ${target} 并读回验证。`,
      intent: 'settings',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-discover',
              toolName: 'discover_application_capabilities',
              input: {
                queries: ['修改界面色调并验证'],
                domains: ['settings'],
                entityTypes: ['settings.registry'],
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
              input: {
                language: 'henji-ts/v1',
                summary: '改色调并读回',
                source: [
                  "const before = await app.entities.read({ kind: 'settings.registry', id: 'singleton' }, ['interface.theme_tone']);",
                  'app.assert.exists(before);',
                  `await app.entities.update({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_tone': '${target}' });`,
                  "const after = await app.entities.read({ kind: 'settings.registry', id: 'singleton' }, ['interface.theme_tone']);",
                  `app.assert.equal(after.properties['interface.theme_tone'], '${target}');`,
                ].join('\n'),
              },
              dynamic: false,
            },
          }],
        },
        { actions: [{ type: 'text', value: '色调已修改并验证。' }] },
      ],
    })

    expect(
      result.state.status,
      `终态 ${result.state.status}；错误 ${JSON.stringify(result.state.error)}；`
      + `工具调用 ${JSON.stringify(result.toolCalls)}`,
    ).toBe('completed')
    expect(result.toolCalls.filter((call) => !call.ok)).toEqual([])

    // 真相源对账：不看 completed，不看 evidence。
    expect(useSettingsStore.getState().themeTonePreset).toBe(target)
    // 写域必须看到 revision 推进，否则说明写入根本没经过正式链路。
    expect(result.finalHostContext.scopeRevisions.settings).toBeGreaterThan(0)
  })

  it('同一脚本里改完再恢复，最终真相源回到原值', async () => {
    /*
     * 规则里明写：同一通用事务允许按顺序多次写同一属性，只有最后一次参与最终状态验证。
     * 这条把那个契约钉在真链路上——中间值真的被写进去过（否则第二次 read 会读到原值而断言失败），
     * 而最终态是恢复后的值。
     */
    const detour = originalTone === 'warm' ? 'cool' : 'warm'
    const result = await runAssistantHarness({
      goal: '改色调后立刻恢复原值。',
      intent: 'settings',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-discover',
              toolName: 'discover_application_capabilities',
              input: {
                queries: ['修改并恢复界面色调'],
                domains: ['settings'],
                entityTypes: ['settings.registry'],
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
              input: {
                language: 'henji-ts/v1',
                summary: '改后恢复',
                source: [
                  `await app.entities.update({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_tone': '${detour}' });`,
                  "const mid = await app.entities.read({ kind: 'settings.registry', id: 'singleton' }, ['interface.theme_tone']);",
                  `app.assert.equal(mid.properties['interface.theme_tone'], '${detour}');`,
                  `await app.entities.update({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_tone': '${originalTone}' });`,
                  "const back = await app.entities.read({ kind: 'settings.registry', id: 'singleton' }, ['interface.theme_tone']);",
                  `app.assert.equal(back.properties['interface.theme_tone'], '${originalTone}');`,
                ].join('\n'),
              },
              dynamic: false,
            },
          }],
        },
        { actions: [{ type: 'text', value: '已恢复原值。' }] },
      ],
    })

    expect(
      result.state.status,
      `终态 ${result.state.status}；${JSON.stringify(result.toolCalls)}`,
    ).toBe('completed')
    expect(useSettingsStore.getState().themeTonePreset).toBe(originalTone)
  })
})
