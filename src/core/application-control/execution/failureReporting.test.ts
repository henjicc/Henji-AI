import { describe, expect, it } from 'vitest'

import type { ApplicationEntityProvider } from '../registry'
import { ApplicationReflectionRegistry } from '../registry'
import { ApplicationControlExecutionEngine } from './engine'
import type {
  ApplicationControlExecutionDependencies,
  ApplicationExecutionContext,
} from './types'

/**
 * 失败报告的诚实性。
 *
 * 实测事故：三维布置是**单步**事务，执行器抛错时一步都没提交，引擎却回报"部分步骤已完成
 * 且未补偿"并把 recoverable 置为 false。模型读到"不可重试、无恢复方案"后按规则停止了所有
 * 后续写入——它的判断是对的，是这条报告在骗它。
 *
 * 同时原始错误被整串吞掉：调用方拿到的永远是"事务执行失败"六个字，既不知道是哪个字段填错，
 * 也不可能自我修正。
 */

const SCOPE = 'sample.scope'

function createEngine(
  fail: () => never,
  extraDependencies: Partial<ApplicationControlExecutionDependencies> = {}
) {
  const provider: ApplicationEntityProvider = {
    entityType: 'sample.item',
    async listEntities() {
      return { refs: [], nextCursor: null, revisions: { [SCOPE]: 0 } }
    },
    async readEntity(ref) {
      return {
        ref, entityType: 'sample.item', revisions: { [SCOPE]: 0 },
        properties: {}, capturedAt: '2026-08-01T00:00:00.000Z',
      }
    },
    async getPropertyAvailability() {
      return []
    },
  }
  const registry = new ApplicationReflectionRegistry('application-capabilities/v2')
  registry.register({
    entity: {
      id: 'sample.item', domain: 'sample', version: 1, title: '样例', description: '样例实体。',
      refKind: 'sample.item', dataClass: 'C0', exposures: ['assistant'], parentTypes: [],
      revisionScopes: [SCOPE], queryCapabilityIds: ['get_sample'],
      schemaRef: {
        catalogVersion: 'application-capabilities/v2', kind: 'entity', id: 'sample.item',
        version: 1, digest: `sha256:${'a'.repeat(64)}`,
      },
    },
    properties: [],
    provider,
  })
  let sequence = 0
  const engine = new ApplicationControlExecutionEngine(registry, {
    now: () => new Date('2026-08-01T00:00:00.000Z'),
    createOpaqueRef: (kind) => `${kind}:${String(++sequence).padStart(20, '0')}`,
    ...extraDependencies,
  })
  engine.registerOperationExecutor({
    capabilityId: 'sample_operation',
    capabilityVersion: 1,
    risk: 'R1',
    requiredPermissions: [],
    supportsAtomic: true,
    normalizeInput: (input) => input,
    getCurrentRevisions: async () => ({ [SCOPE]: 0 }),
    execute: async () => fail(),
  })
  return engine
}

function context(): ApplicationExecutionContext {
  return {
    requestId: 'request-failure-reporting',
    exposure: 'assistant',
    permissions: new Set<string>(),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2', 'C3']),
    approvalMode: 'auto',
  } as ApplicationExecutionContext
}

async function commitFailingPlan(fail: () => never) {
  const engine = createEngine(fail)
  const plan = await engine.plan({
    summary: '单步操作',
    transactionMode: 'atomic',
    steps: [{
      kind: 'operation', capabilityId: 'sample_operation', capabilityVersion: 1,
      input: {}, expectedRevisions: { [SCOPE]: 0 },
    }],
  }, context())
  return await engine.commit({
    planRef: plan.planRef,
    expectedRevisions: { [SCOPE]: 0 },
    idempotencyKey: 'idempotency-failure-0001',
    approvedRisk: 'R1',
  }, context())
}

describe('事务失败报告', () => {
  it('零步提交时如实说明应用未改变，且允许重试', async () => {
    const result = await commitFailingPlan(() => {
      throw new Error('TARGET_OBJECT_NOT_FOUND：targetObjectId «立方体» 不是本场景中的对象 id')
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.message).toContain('未改变')
    expect(result.message).not.toContain('部分步骤已完成')
    expect(result.recoverable).toBe(true)
    expect(result.partial?.uncompensatedStepIndexes ?? []).toEqual([])
  })

  it('原始错误必须出现在结果里，模型才可能自我修正', async () => {
    const result = await commitFailingPlan(() => {
      throw new Error('TARGET_OBJECT_NOT_FOUND：targetObjectId «立方体» 不是本场景中的对象 id')
    })
    expect(result.status === 'failed' && result.message).toContain('targetObjectId')
    expect(result.status === 'failed' && result.message).toContain('立方体')
  })

  /*
   * 拒绝通用增删时不能给死胡同。
   *
   * 实测「给场景加个球」时模型收到的就是一句 `camera_stage.object 未声明可增删`，它据此推断
   * "应用当前版本不允许通过助手新增几何对象"——而 place_camera_stage_object 一直都在。
   * 拒绝本身没错，错在这句话没说正确的路在哪，最后变成一次凭空的能力否认。
   *
   * 这里守机制；那张 entityType → 能力 id 的表由能力目录派生，内容由
   * features/assistant/applicationCapabilities/collectionCoverage.test.ts 守。
   */
  it('通用增删被拒时，错误里点名真正能做这件事的专用能力', async () => {
    const engine = createEngine(() => {
      throw new Error('不会走到这里')
    }, {
      describeCollectionWriters: (entityType, operation) => (
        entityType === 'sample.item' && operation === 'create' ? ['place_sample_item'] : []
      ),
    })
    const plan = await engine.plan({
      summary: '创建一个样例',
      transactionMode: 'atomic',
      steps: [{
        kind: 'collection', entityType: 'sample.item',
        parent: { kind: 'sample.item', id: 'sample-parent' },
        operation: { kind: 'create', items: [{ properties: {} }] },
        expectedRevisions: { [SCOPE]: 0 },
      }],
    }, context())
    const result = await engine.commit({
      planRef: plan.planRef, expectedRevisions: { [SCOPE]: 0 },
      idempotencyKey: 'idempotency-dead-end-001', approvedRisk: 'R1',
    }, context())

    expect(result.status).toBe('failed')
    expect(
      result.status === 'failed' ? result.message : '',
      '拒绝里没有点名替代能力，模型只会得到一个死胡同',
    ).toContain('place_sample_item')
  })
})
