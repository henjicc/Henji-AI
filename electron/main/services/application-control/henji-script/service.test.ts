import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineApplicationCapability } from '../../../../../src/core/assistant/capabilities/defineApplicationCapability'
import {
  HENJI_SCRIPT_LANGUAGE,
  runHenjiScriptCapability,
  runHenjiScriptOutputSchema,
} from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolGatewayResult } from '../../../../../src/core/assistant/toolContracts'
import { createBackendCapabilityTool } from '../../agent-runtime/tools/backend-capability-tool'
import { decideToolAuthorization } from '../../agent-runtime/tools/approval-policy'
import { AgentToolRegistry } from '../../agent-runtime/tools/registry'
import type { AgentToolExecuteRequest } from '../../agent-runtime/tools/types'
import { HenjiScriptService } from './service'

function context(): HostContextSnapshot {
  return {
    schemaVersion: 'agent-contract/v2', rendererSessionId: 'renderer-script', revision: 1,
    scopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1, settings: 1 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    project: { id: null, selectedNodeId: null }, generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null }, uiReady: true,
    availableCapabilities: [], capturedAt: new Date().toISOString(),
  }
}

function capability(
  id: string,
  version: number,
  readOnly: boolean,
  executionPrerequisites?: string[],
  effect: 'observe' | 'update' | 'navigate' = readOnly ? 'observe' : 'update',
) {
  return defineApplicationCapability({
    id, version, title: id, description: `测试 ${id}`, domain: 'test', aliases: [], side: 'backend',
    readOnly, risk: readOnly ? 'R0' : 'R1', dataClasses: ['C1'], permission: `test:${id}`,
    idempotent: readOnly, destructive: false, timeoutMs: 5_000,
    supportsPreview: false, supportsUndo: false, requiredScopes: ['toolbox'],
    executionPrerequisites,
    inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()),
    control: {
      execution: { mode: 'immediate', cancelable: false, resultState: readOnly ? 'observed' : 'completed' },
      impacts: [{
        effect, entityTypes: ['test.entity'],
        propertyIds: [], revisionScopes: ['toolbox'], verificationRequired: !readOnly,
      }],
    },
    resolveObservedEffects: (_input, output) => [{
      effect, entityTypes: ['test.entity'], propertyIds: [],
      targetRefs: [{ kind: 'test.entity', id: String(output.id ?? 'entity-1') }],
      count: 1, verified: readOnly, evidence: [],
    }],
  })
}

function fixture(version = 7, extraActions: string[] = []) {
  const registry = new AgentToolRegistry()
  for (const item of [
    capability('read_test_state', version, true),
    capability('hidden_test_action', 1, false),
    capability('write_without_receipt', 1, false),
    capability('prepare_generation_task', 1, true),
    capability('create_visible_generation_task', 1, false, ['prepare_generation_task']),
    capability('get_generation_task', 1, true),
    capability('get_current_application_context', 1, true),
    capability('change_application_entities', 2, false),
    capability('describe_application_entities', 1, true),
    capability('read_application_entity', 1, true),
    capability('list_application_entities', 1, true),
  ]) registry.register(createBackendCapabilityTool(item, { execute: async () => ({}) }))
  const host = context()
  const calls: AgentToolExecuteRequest[] = []
  let value = 0
  const gateway = {
    execute: async (request: AgentToolExecuteRequest): Promise<AgentToolGatewayResult> => {
      calls.push(request)
      let output: Record<string, unknown> = { id: 'entity-1', value }
      let effects = registry.get(request.toolName)?.capability?.resolveObservedEffects?.(request.input, output) ?? []
      if (request.toolName === 'change_application_entities') {
        const change = (request.input as { changes: Array<Record<string, unknown>> }).changes[0] ?? {}
        const effect = change.kind === 'create_items' ? 'create'
          : change.kind === 'remove_items' ? 'delete' : 'update'
        if (change.kind === 'set_properties') {
          value = Number((change.properties as Record<string, unknown>)['test.entity.value'])
        }
        output = {
          resultRefs: [
            { kind: 'test.entity', id: 'entity-1' },
            ...(effect === 'create' ? [{ kind: 'test.root', id: 'root-1' }] : []),
          ],
          transactionRef: 'transaction-1',
        }
        effects = [{
          effect, entityTypes: ['test.entity'],
          propertyIds: effect === 'update' ? ['test.entity.value'] : [],
          targetRefs: [{ kind: 'test.entity', id: 'entity-1' }], count: 1, verified: false, evidence: [],
        }]
      } else if (request.toolName === 'read_application_entity') {
        output = {
          ref: { kind: 'test.entity', id: 'entity-1' }, entityType: 'test.entity',
          properties: { 'test.entity.value': value }, capturedAt: new Date().toISOString(), revisions: { toolbox: 2 },
        }
        effects = [{
          effect: 'observe', entityTypes: ['test.entity'], propertyIds: ['test.entity.value'],
          targetRefs: [{ kind: 'test.entity', id: 'entity-1' }], count: 1, verified: true, evidence: ['formal-read'],
        }]
      } else if (request.toolName === 'create_visible_generation_task') {
        output = { taskId: 'task-script-1', status: 'submitted' }
        effects = [{
          effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: 'task-script-1' }],
          count: 1, verified: false, evidence: ['submitted'],
        }]
      } else if (request.toolName === 'get_generation_task') {
        output = { task: { taskId: 'task-script-1', status: 'success', resultAvailable: true } }
        effects = [{
          effect: 'observe', entityTypes: ['generation.task', 'generation.result'], propertyIds: [],
          targetRefs: [{ kind: 'generation.task', id: 'task-script-1' }],
          count: 1, verified: true, evidence: ['success'],
        }]
      } else if (request.toolName === 'describe_application_entities') {
        output = {
          entities: [{ id: 'test.entity', parentTypes: ['test.root'] }],
          properties: [], propertyAvailability: [], collectionAvailability: [],
        }
        effects = [{
          effect: 'observe', entityTypes: ['test.entity'], propertyIds: [], targetRefs: [],
          count: 1, verified: true, evidence: ['formal-describe'],
        }]
      } else if (request.toolName === 'list_application_entities') {
        const entityType = (request.input as { entityType: string }).entityType
        output = {
          refs: entityType === 'test.root' ? [{ kind: 'test.root', id: 'root-1' }] : [],
          nextCursor: null, revisions: { toolbox: 2 },
        }
        effects = [{
          effect: 'observe', entityTypes: [entityType], propertyIds: [], targetRefs: [],
          count: 1, verified: true, evidence: ['formal-list'],
        }]
      }
      return {
        status: 'completed', cached: false,
        observation: {
          source: { toolName: request.toolName, toolVersion: registry.get(request.toolName)?.version ?? 1, toolCallId: request.toolCallId },
          trust: 'untrusted_observation', dataClasses: ['C1'], summary: `${request.toolName} ok`, output, effects,
        },
      }
    },
  }
  const lease = {
    actions: new Set(['read_test_state', 'write_without_receipt', 'prepare_generation_task', 'create_visible_generation_task', 'get_generation_task', ...extraActions]),
    recipes: new Set<string>(),
    entityTypes: new Set(['test.entity']),
    propertyIds: new Set(['test.entity.value']),
    propertyDefinitions: new Map(),
    forbiddenEffects: new Set<'observe' | 'create' | 'update' | 'delete' | 'navigate' | 'execute'>(),
  }
  return {
    registry, host, calls, gateway, lease,
    service: new HenjiScriptService({ registry, getLease: () => lease }),
  }
}

async function run(source: string, version = 7) {
  const current = fixture(version)
  const output = await current.service.execute({
    language: HENJI_SCRIPT_LANGUAGE, summary: '测试脚本', source,
  }, {
    runId: 'run-script', threadId: 'thread-script', toolCallId: 'parent-script',
    signal: new AbortController().signal, gateway: current.gateway as never,
    getHostContext: () => current.host,
  })
  return { ...current, output }
}

describe('HenjiScriptService', () => {
  it('用户禁止的 Effect 在首次 Gateway 调用前被脚本预检拒绝', async () => {
    const current = fixture(7, ['hidden_test_action'])
    current.registry.register(createBackendCapabilityTool(
      capability('navigate_test_surface', 1, false, undefined, 'navigate'),
      { execute: async () => ({ id: 'surface-1' }) },
    ))
    current.lease.actions.add('navigate_test_surface')
    current.lease.forbiddenEffects.add('navigate')

    const output = await current.service.execute({
      language: HENJI_SCRIPT_LANGUAGE,
      summary: '禁止导航测试',
      source: "await app.action('navigate_test_surface', {});",
    }, {
      runId: 'run-forbidden-effect', threadId: 'thread-script', toolCallId: 'parent-script',
      signal: new AbortController().signal, gateway: current.gateway as never,
      getHostContext: () => current.host,
    })

    expect(output.status).toBe('failed')
    expect(output.error).toMatchObject({ code: 'SCRIPT_PLAN_REJECTED', phase: 'preflight' })
    expect(current.calls).toHaveLength(0)
  })

  it('同一脚本用正式输出推进 revision 游标，前一步自己的写入不会让后一步误报 CONFLICT', async () => {
    const current = fixture(7, ['hidden_test_action'])
    let authoritativeRevision = 1
    const gateway = {
      execute: async (request: AgentToolExecuteRequest): Promise<AgentToolGatewayResult> => {
        if (request.expectedRevisions?.toolbox !== authoritativeRevision) throw new Error('CONFLICT')
        const result = await current.gateway.execute(request)
        if (request.toolName === 'hidden_test_action') authoritativeRevision += 1
        if (result.status === 'completed') {
          result.observation.output = {
            ...(result.observation.output as Record<string, unknown>),
            revision: authoritativeRevision,
            scopeRevisions: { toolbox: authoritativeRevision },
          }
        }
        return result
      },
    }
    const output = await current.service.execute({
      language: HENJI_SCRIPT_LANGUAGE,
      summary: '连续写入',
      source: `
        await app.action('hidden_test_action', { id: 'first' });
        await app.action('hidden_test_action', { id: 'second' });
      `,
    }, {
      runId: 'run-script', threadId: 'thread-script', toolCallId: 'parent-script',
      signal: new AbortController().signal, gateway: gateway as never,
      getHostContext: () => current.host,
    })

    expect(output.error?.message ?? null).toBeNull()
    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(current.calls.map((call) => call.expectedRevisions?.toolbox)).toEqual([1, 2])
  })

  it('导航返回后的异步界面挂载只刷新已声明作用域，再执行后续写入', async () => {
    const current = fixture(7, ['navigate_test_action', 'hidden_test_action'])
    current.registry.register(createBackendCapabilityTool(
      capability('navigate_test_action', 1, false, undefined, 'navigate'),
      { execute: async () => ({}) },
    ))
    let authoritativeRevision = 1
    const gateway = {
      execute: async (request: AgentToolExecuteRequest): Promise<AgentToolGatewayResult> => {
        if (request.toolName === 'get_current_application_context') {
          authoritativeRevision = 3
          return {
            status: 'completed', cached: false,
            observation: {
              source: { toolName: request.toolName, toolVersion: 1, toolCallId: request.toolCallId },
              trust: 'untrusted_observation', dataClasses: ['C1'], summary: 'context refreshed',
              output: { revision: 3, scopeRevisions: { toolbox: authoritativeRevision } }, effects: [],
            },
          }
        }
        if (request.expectedRevisions?.toolbox !== authoritativeRevision) throw new Error('CONFLICT')
        const result = await current.gateway.execute(request)
        if (request.toolName === 'navigate_test_action') authoritativeRevision = 2
        else if (request.toolName === 'hidden_test_action') authoritativeRevision += 1
        if (result.status === 'completed') {
          result.observation.output = {
            ...(result.observation.output as Record<string, unknown>),
            revision: authoritativeRevision,
            scopeRevisions: { toolbox: authoritativeRevision },
          }
        }
        if (request.toolName === 'navigate_test_action') authoritativeRevision = 3
        return result
      },
    }
    const service = new HenjiScriptService({
      registry: current.registry,
      getLease: () => ({
        actions: new Set(['navigate_test_action', 'hidden_test_action']),
        recipes: new Set<string>(), entityTypes: new Set<string>(), propertyIds: new Set<string>(), propertyDefinitions: new Map(),
      }),
    })
    const output = await service.execute({
      language: HENJI_SCRIPT_LANGUAGE, summary: '导航后写入',
      source: `
        await app.action('navigate_test_action', {});
        await app.action('hidden_test_action', { id: 'after-navigation' });
      `,
    }, {
      runId: 'run-script', threadId: 'thread-script', toolCallId: 'parent-script',
      signal: new AbortController().signal, gateway: gateway as never,
      getHostContext: () => current.host,
    })

    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(current.calls.map((call) => call.toolName)).toEqual([
      'navigate_test_action', 'hidden_test_action',
    ])
  })

  it('算法写能力没有返回验证契约要求的 Effect Receipt 时拒绝完成', async () => {
    const current = fixture()
    const definition = current.registry.get('write_without_receipt')
    if (!definition?.capability) throw new Error('测试能力未注册')
    definition.capability.resolveObservedEffects = () => []
    const output = await current.service.execute({
      language: HENJI_SCRIPT_LANGUAGE,
      summary: '验证 Effect 契约',
      source: "await app.action('write_without_receipt', { id: 'entity-1' });",
    }, {
      runId: 'run-script', threadId: 'thread-script', toolCallId: 'parent-script',
      signal: new AbortController().signal, gateway: current.gateway as never,
      getHostContext: () => current.host,
    })
    expect(output.status).toBe('failed')
    expect(output.error).toMatchObject({ code: 'SCRIPT_VERIFICATION_FAILED', phase: 'verify' })
    expect(current.calls).toHaveLength(1)
  })

  it('完整稳定引用携带 label 与 revision 时仍能通过顶层输出契约', async () => {
    const { output } = await run("await app.action('read_test_state', { id: 'entity-1' });")
    expect(() => runHenjiScriptOutputSchema.parse({
      ...output,
      resultRefs: [{ kind: 'test.entity', id: 'entity-1', label: '测试实体', revision: 2 }],
      steps: output.steps.map((step) => ({
        ...step,
        resultRefs: [{ kind: 'test.entity', id: 'entity-1', label: '测试实体', revision: 2 }],
      })),
    })).not.toThrow()
  })

  it('审批目标与编译预览目标严格一致，真实 Gateway 不会在解释器前拒绝', () => {
    const current = fixture()
    const input = {
      language: HENJI_SCRIPT_LANGUAGE,
      summary: '读取测试状态',
      source: "await app.action('read_test_state', { id: 'entity-1' });",
    } as const

    expect(runHenjiScriptCapability.resolveTargetIds?.(input))
      .toEqual(current.service.preview(input).targetIds)
  })

  it('显式用户任务中的受控脚本不会产生重复顶层审批', () => {
    expect(decideToolAuthorization({
      mode: 'assistant_decides',
      risk: runHenjiScriptCapability.risk,
      readOnly: runHenjiScriptCapability.readOnly,
      destructive: runHenjiScriptCapability.destructive,
      dataClasses: runHenjiScriptCapability.dataClasses,
      explicitUserIntent: true,
    })).toBe('auto_allowed')
  })

  it('由宿主解析当前能力版本，模型源码不包含 version/revision/$from', async () => {
    const { output, calls, registry } = await run(`
      const result = await app.action('read_test_state', { id: 'entity-1' });
      app.assert.equal(result.id, 'entity-1');
    `, 11)

    expect(output.status).toBe('completed')
    expect(registry.get('read_test_state')?.version).toBe(11)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      toolName: 'read_test_state', authorizationSource: 'approved_script',
      parentToolCallId: 'parent-script',
    })
    expect(calls[0].input).not.toHaveProperty('version')
  })

  it('动作输出统一从 Effect Receipt 补齐稳定 resultRefs，脚本无需猜测 ID', async () => {
    const { output } = await run(`
      const result = await app.action('read_test_state', { id: 'entity-1' });
      app.assert.exists(result.resultRefs);
      app.assert.equal(result.resultRefs[0].id, 'entity-1');
    `)

    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(output.resultRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'test.entity', id: 'entity-1' }),
    ]))
  })

  it('实体更新后自动从正式状态源读回并验证', async () => {
    const { output, calls } = await run(`
      await app.entities.update({ kind: 'test.entity', id: 'entity-1' }, {
        'test.entity.value': 42
      });
    `)

    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(calls.map((call) => call.toolName)).toEqual([
      'change_application_entities', 'read_application_entity',
    ])
    expect(output.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'update', verified: false }),
      expect.objectContaining({ effect: 'observe', verified: true }),
    ]))
    expect(output.verification.evidence).toEqual(['step_1:read-back:test.entity'])
  })

  it('实体 CRUD 使用稳定的位置参数签名并逐项正式读回', async () => {
    const { output, calls } = await run(`
      const created = await app.entities.create('test.entity', {
        properties: { 'test.entity.value': 1 }
      });
      const ref = created.resultRefs[0];
      await app.entities.update(ref, { 'test.entity.value': 2 });
      await app.entities.remove(ref);
    `)

    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(calls.map((call) => call.toolName)).toEqual([
      'describe_application_entities', 'list_application_entities',
      'change_application_entities', 'read_application_entity',
      'change_application_entities', 'read_application_entity',
      'change_application_entities', 'list_application_entities',
    ])
    expect(output.effects.filter((effect) => effect.effect === 'observe')).toHaveLength(3)
  })

  it('跨脚本完整引用删除时由宿主解析唯一父上下文', async () => {
    const { output, calls } = await run(`
      const ref = { kind: 'test.entity', id: 'entity-1' };
      await app.entities.remove(ref);
    `)
    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(calls.map((call) => call.toolName)).toEqual([
      'describe_application_entities', 'list_application_entities',
      'change_application_entities', 'list_application_entities',
    ])
  })

  /*
   * "删掉它，然后确认它不在了"是用户会原样说出口的话，脚本必须写得出来。
   *
   * 之前写不出来：remove 之后再 read 同一个引用必然抛 ENTITY_NOT_FOUND，整段脚本失败；而 list
   * 返回的 refs 在受限语言里没法过滤（不支持 .find/.filter，for...of 只遍历静态数组）。模型只能
   * 在"照做"和"脚本能跑"之间二选一——实测素材库那次它选了照做，最后一段失败，8 个真实写入全部
   * 没能封存。
   *
   * 放行的依据是事实而不是宽容：remove 的 verifyEntityCall 刚 list 过一遍确认它真的不在了。
   */
  it('删除后再读同一个引用返回 null，可以直接断言 absent', async () => {
    const { output, calls } = await run(`
      const ref = { kind: 'test.entity', id: 'entity-1' };
      await app.entities.remove(ref);
      const after = await app.entities.read(ref, ['test.entity.value']);
      app.assert.absent(after);
    `)

    expect(output).toMatchObject({ status: 'completed', verification: { passed: true } })
    // 关键：删除后的那次 read 不再打到网关，因为 remove 的读回验证已经确认过不存在
    expect(calls.filter((call) => call.toolName === 'read_application_entity')).toHaveLength(0)
    expect(output.verification.evidence).toEqual(
      expect.arrayContaining([expect.stringContaining('absence-confirmed')])
    )
  })

  it('没删过的引用读不到时照旧硬报错', async () => {
    const { output } = await run(`
      const missing = await app.entities.read({ kind: 'test.entity', id: 'never-existed' }, []);
      app.assert.absent(missing);
    `)
    expect(output.status).not.toBe('completed')
  })


  /*
   * 断言失败必须报出实际值：运行时手里明明有 actual 和 expected 两个值，只说"断言 equal 未通过"
   * 等于让调用方整段重写脚本再猜一遍，而真实原因可能只是名称多了个空格。实测素材库那次连撞两次。
   */
  it('断言失败时报出实际值与期望值', async () => {
    const { output } = await run(`
      const entity = await app.entities.read(
        { kind: 'test.entity', id: 'entity-1' },
        ['test.entity.value']
      );
      app.assert.equal(entity.properties['test.entity.value'], 999);
    `)

    expect(output.error).toMatchObject({ code: 'SCRIPT_VERIFICATION_FAILED' })
    expect(output.error?.message).toContain('实际值')
    expect(output.error?.message).toContain('999')
  })

  it('matches 失败时说明它是子串包含而不是正则', async () => {
    const { output } = await run(`
      const entity = await app.entities.read(
        { kind: 'test.entity', id: 'entity-1' },
        ['test.entity.value']
      );
      app.assert.matches(entity.ref.id, '^entity-\\d+$');
    `)
    expect(output.error?.message).toContain('子串包含')
  })


  it('未发现 API 与截断引用都在执行器调用次数为 0 时拒绝', async () => {
    const unknown = await run("await app.action('not_registered', {});")
    expect(unknown.output).toMatchObject({
      status: 'failed', error: { code: 'SCRIPT_API_NOT_DISCOVERED', phase: 'preflight' },
    })
    expect(unknown.calls).toHaveLength(0)

    const registeredButNotLeased = await run("await app.action('hidden_test_action', {});")
    expect(registeredButNotLeased.output).toMatchObject({
      status: 'failed', error: { code: 'SCRIPT_API_NOT_DISCOVERED', phase: 'preflight' },
    })
    expect(registeredButNotLeased.calls).toHaveLength(0)

    const truncated = await run(`
      await app.entities.update({ kind: 'test.entity', id: 'entity-…' }, { 'test.entity.value': 1 });
    `)
    expect(truncated.output).toMatchObject({
      status: 'failed', error: { code: 'SCRIPT_PLAN_REJECTED' },
    })
    expect(truncated.calls).toHaveLength(0)
  })

  it('租约中的属性约束会在首次 Gateway 调用前拒绝三元表达式里的非法候选值', async () => {
    const current = fixture()
    current.lease.propertyDefinitions.set('test.entity.value', {
      id: 'test.entity.value', entityType: 'test.entity', title: '测试值', description: '枚举测试值',
      value: { kind: 'enum', values: [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }] },
      nullable: false, writable: true, writeOperations: ['set'],
    })
    const output = await current.service.execute({
      language: HENJI_SCRIPT_LANGUAGE,
      summary: '非法枚举不应进入执行器',
      source: `
        const before = await app.entities.read(
          { kind: 'test.entity', id: 'entity-1' }, ['test.entity.value']
        );
        const next = before.properties['test.entity.value'] === 'alpha' ? 'gamma' : 'beta';
        await app.entities.update(before.ref, { 'test.entity.value': next });
      `,
    }, {
      runId: 'run-script', threadId: 'thread-script', toolCallId: 'script-call',
      signal: new AbortController().signal, gateway: current.gateway as never,
      getHostContext: () => current.host,
    })

    expect(output).toMatchObject({
      status: 'failed', error: { code: 'SCRIPT_PLAN_REJECTED', phase: 'preflight' },
    })
    expect(current.calls).toHaveLength(0)
  })

  it('预览不吞掉编译错误，正式执行返回带阶段的脚本错误且零调用', async () => {
    const current = fixture()
    const input = {
      language: HENJI_SCRIPT_LANGUAGE,
      summary: '非法脚本',
      source: "const result = await app.action('read_test_state', {}); result.items.find(() => true);",
    } as const
    expect(() => current.service.preview(input)).not.toThrow()
    const output = await current.service.execute(input, {
      runId: 'run-script', threadId: 'thread-script', toolCallId: 'script-call',
      signal: new AbortController().signal, gateway: current.gateway as never,
      getHostContext: () => current.host,
    })
    expect(output).toMatchObject({
      status: 'failed', error: { code: 'SCRIPT_UNSUPPORTED_SYNTAX', phase: 'compile' },
    })
    expect(current.calls).toHaveLength(0)
  })

  it('已有真实写入后失败返回 partial，不谎报全部失败', async () => {
    const { output } = await run(`
      await app.entities.update({ kind: 'test.entity', id: 'entity-1' }, { 'test.entity.value': 2 });
      app.assert.equal(1, 2);
    `)
    expect(output).toMatchObject({
      status: 'partial', error: { code: 'SCRIPT_VERIFICATION_FAILED' },
    })
    expect(output.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'update', verified: false }),
      expect.objectContaining({ effect: 'observe', verified: true }),
    ]))
  })

  it('外部生成完成后从持久化 IR 断点续跑，不再次执行提交步骤', async () => {
    const current = fixture()
    const executionContext = {
      runId: 'run-script', threadId: 'thread-script', toolCallId: 'parent-script',
      signal: new AbortController().signal, gateway: current.gateway as never,
      getHostContext: () => current.host,
    }
    const waiting = await current.service.execute({
      language: HENJI_SCRIPT_LANGUAGE, summary: '生成后继续验证',
      source: `
        await app.action('prepare_generation_task', { prompt: '测试图片' });
        const submitted = await app.action('create_visible_generation_task', { prompt: '测试图片' });
        const completed = await app.action('get_generation_task', { taskId: submitted.taskId });
        app.assert.equal(completed.task.status, 'success');
      `,
    }, executionContext)

    expect(waiting).toMatchObject({
      status: 'waiting_external', checkpoint: { nextInstruction: 2 },
      submittedTasks: [{ taskId: 'task-script-1', status: 'submitted' }],
    })
    expect(current.calls.map((call) => call.toolName)).toEqual([
      'prepare_generation_task', 'create_visible_generation_task',
    ])

    const resumed = await current.service.resume(waiting.checkpoint!, 'success', executionContext)
    expect(resumed).toMatchObject({ status: 'completed', verification: { passed: true } })
    expect(current.calls.map((call) => call.toolName)).toEqual([
      'prepare_generation_task', 'create_visible_generation_task', 'get_generation_task',
    ])
  })

  it('缺少声明的前序能力时在首次写入前拒绝', async () => {
    const current = await run(`
      await app.action('create_visible_generation_task', { prompt: '不应提交' });
    `)
    expect(current.output).toMatchObject({
      status: 'failed', error: { code: 'SCRIPT_PLAN_REJECTED', phase: 'preflight' },
    })
    expect(current.calls).toHaveLength(0)
  })
})
