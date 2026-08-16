// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '@/core/assistant/hostContracts'
import { applicationReflectionHandlers } from '@/features/assistant/applicationCapabilities/applicationReflectionAdapter'
import { useSettingsStore } from '@/stores/settingsStore'
import { HenjiScriptService } from '../../../../electron/main/services/application-control/henji-script/service'
import { createBuiltinAgentToolRegistry } from '../../../../electron/main/services/agent-runtime/tools/builtin'
import { AgentToolGateway } from '../../../../electron/main/services/agent-runtime/tools/gateway'

import { getSettingsRegistryRevision } from './settingsApplicationService'

function hostContext(): HostContextSnapshot {
  const settingsRevision = getSettingsRegistryRevision()
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'settings-henji-script-result',
    revision: settingsRevision,
    scopeRevisions: {
      navigation: 0, generation: 0, canvas: 0, toolbox: 0,
      assets: 0, settings: settingsRevision, surface: 0,
    },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [
      'describe_application_entities', 'list_application_entities',
      'read_application_entity', 'change_application_entities',
    ],
    capturedAt: new Date().toISOString(),
  }
}

async function executeSettingsRecipe(
  nextTone: string,
  corruptReadBack = false,
) {
  const registry = createBuiltinAgentToolRegistry(async (operation, context) => {
    const invocation = operation.capability
    const requestContext = {
      signal: context.signal,
      requestId: context.toolCallId,
      expectedRevisions: invocation.expectedRevisions ?? {},
    }
    const rawData = invocation.id === 'describe_application_entities'
      ? await applicationReflectionHandlers.describeEntities(invocation.input as never, requestContext)
      : invocation.id === 'list_application_entities'
        ? await applicationReflectionHandlers.listEntities(invocation.input as never, requestContext)
        : invocation.id === 'read_application_entity'
          ? await applicationReflectionHandlers.readEntity(invocation.input as never, requestContext)
          : await applicationReflectionHandlers.changeEntities(invocation.input as never, requestContext)
    const data = corruptReadBack && invocation.id === 'read_application_entity'
      ? {
          ...(rawData as unknown as Record<string, unknown>),
          properties: {
            ...((rawData as unknown as { properties?: object }).properties ?? {}),
            'interface.theme_tone': useSettingsStore.getState().themeTonePreset === 'warm' ? 'cool' : 'warm',
          },
        }
      : rawData
    const snapshot = hostContext()
    return {
      ok: true,
      data: { ...data, revision: snapshot.revision, scopeRevisions: snapshot.scopeRevisions },
      resultingRevision: snapshot.revision,
      resultingScopeRevisions: snapshot.scopeRevisions,
    }
  })
  const gateway = new AgentToolGateway({
    registry,
    getHostContext: () => hostContext(),
    appendPermissionAudit: async () => {},
  })
  const service = new HenjiScriptService({
    registry,
    getLease: () => ({
      actions: new Set(), recipes: new Set(['settings.batch_update']),
      entityTypes: new Set(['settings.registry']),
      propertyIds: new Set(['interface.theme_tone']),
      propertyDefinitions: new Map(),
    }),
  })
  return await service.execute({
    language: 'henji-ts/v1', summary: '批量修改并验证设置',
    source: `
      const result = await app.recipe('settings.batch_update', {
        changes: [{ id: 'interface.theme_tone', value: '${nextTone}' }]
      });
      app.assert.exists(result.resultRefs);
    `,
  }, {
    runId: 'settings-script-run', threadId: 'settings-script-thread',
    toolCallId: 'settings-script-call', signal: new AbortController().signal,
    gateway, getHostContext: () => hostContext(),
  })
}

describe('应用设置 Henji Recipe 的正式结果', () => {
  let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']

  beforeEach(() => { originalTone = useSettingsStore.getState().themeTonePreset })
  afterEach(() => { useSettingsStore.getState().setThemeTonePreset(originalTone) })

  it('同一解释器完成结构检查、事务写入、正式读回与断言', async () => {
    const nextTone = originalTone === 'warm' ? 'cool' : 'warm'
    const result = await executeSettingsRecipe(nextTone)

    expect(result.status, JSON.stringify(result)).toBe('completed')
    expect(result.steps.map((step) => step.stepId)).toEqual(expect.arrayContaining([
      'step_1__describe', 'step_1__change', 'step_1__verify', 'step_1__assert_0', 'step_1',
    ]))
    expect(useSettingsStore.getState().themeTonePreset).toBe(nextTone)
    expect(result.effects).toEqual(expect.arrayContaining([expect.objectContaining({
      effect: 'update', entityTypes: ['settings.registry'], propertyIds: ['interface.theme_tone'],
      targetRefs: [{ kind: 'settings.registry', id: 'singleton' }],
    })]))
    expect(result.verification).toMatchObject({ passed: true })
  })

  it('正式读回值与目标不一致时不得把脚本报告为完成', async () => {
    const nextTone = originalTone === 'warm' ? 'cool' : 'warm'
    const result = await executeSettingsRecipe(nextTone, true)

    expect(result).toMatchObject({
      ok: false,
      status: 'partial',
      error: { code: 'SCRIPT_VERIFICATION_FAILED', phase: 'verify' },
      verification: { passed: false },
    })
    expect(result.effects.length).toBeGreaterThan(0)
  })
})
