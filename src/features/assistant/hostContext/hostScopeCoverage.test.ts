// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/applicationReflectionApplicationCapabilities'

import { createHostContextSnapshot } from './hostContext'

/**
 * 门禁：**provider 自报的每个 revision scope，宿主都必须发布得出来。**
 *
 * 通用写入的计划器要求调用方为目标实体的**每一个** revision scope 提供期望值
 * （`planner.assertRevisions` 按 `Object.keys(revisions)` 逐个要），而调用方——也就是模型经
 * Gateway 信封——能拿到的只有宿主快照的 `scopeRevisions`。scope 没发布，期望值就永远给不出，
 * 那条属性于是**声明可写、实际写不了**：报 `EXPECTED_REVISION_REQUIRED:<scope>`，
 * 而且没有任何恢复路径（适配器的重试分支只处理 `REVISION_CONFLICT`）。
 *
 * 实测漏了两个：`generation.draft`（草稿 store 的 revision）与 `generation.model`
 * （模型可见性事件计数）。两个 provider 各自有真实 revision，却从没发布出来，于是"改提示词
 * 草稿""隐藏某个模型"这两条路对助手一直是死的——而覆盖门禁看不见它，因为
 * `propertyCoverage` / `storeActionCoverage` 守的是"声明与执行器一致"，
 * 不是"这条路经 Gateway 走得通"。
 *
 * 这条与 `capability-domain-coverage.test.ts` 是同一族：那条守"模型说得出域名"，
 * 这条守"模型给得出并发基线"。都属于**注册了但用不上**这一类事故。
 */
/**
 * 已知发布不出来的 scope。**只许变短。**
 *
 * 登记在这里不等于可以放着——它意味着那批属性对助手是死的，用户在界面上做得到、助手做不到。
 */
const KNOWN_UNPUBLISHABLE: Record<string, string> = {
  /*
   * `image_mark` 的 revision 是**单份会话文档的内容哈希**（`documentRevision()` 对文档做
   * djb2），每个实例一个值，不是领域级的单调计数器——宿主快照发布的是领域级基线，
   * 结构上放不下它。而模型也补不上：`change_application_entities` 的 AI schema 明确
   * `omit({ expectedRevisions: true })`，期望值只能来自 Gateway 信封的 HostScope。
   *
   * 后果：`image_mark.document.*` 与 `image_mark.annotation.data` 声明可写，经通用动词写入
   * 必然 `EXPECTED_REVISION_REQUIRED:image_mark`，且没有恢复路径。用户在图片编辑器里能改，
   * 助手改不了。
   *
   * 修法二选一，都要改 provider 而不是改这份清单：
   * (a) 让 image_mark provider 改报领域级单调计数（任一会话文档变化即 +1），与 canvas /
   *     settings 等域一致，宿主随即发布得出来；代价是并发基线变粗，多会话同时编辑时会有
   *     多余的 CONFLICT——单用户桌面场景可以接受。
   * (b) 若确认这些属性不需要乐观并发（写入前的 availability 复核已经够），就去掉
   *     `revisionScopes` 声明，别要一个谁都给不出的期望值。
   */
  image_mark: '会话文档内容哈希是每实例一个值，领域级快照放不下；需要 provider 改报领域级计数或取消 revisionScopes 声明',
}

describe('宿主必须发布 provider 需要的全部 revision scope', () => {
  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  it('每条可写属性声明的 revisionScopes 都在宿主快照里', () => {
    const registry = getApplicationReflectionRegistry()
    const description = registry.describe({}, {
      exposure: 'assistant',
      permissions: new Set(registry.listDeclaredPropertyPermissions()),
      acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
    })
    // 防空转：属性规模塌下去说明注册链路本身出问题了，下面的遍历会假绿。
    expect(description.properties.length).toBeGreaterThan(60)

    const published = new Set(Object.keys(createHostContextSnapshot().scopeRevisions))
    expect(published.size, '宿主快照没发布任何 scope').toBeGreaterThan(4)

    const missing = new Map<string, string[]>()
    for (const property of description.properties) {
      if (property.readOnlyReason) continue
      for (const scope of property.revisionScopes ?? []) {
        if (published.has(scope) || scope in KNOWN_UNPUBLISHABLE) continue
        const owners = missing.get(scope) ?? []
        if (owners.length < 4) owners.push(property.id)
        missing.set(scope, owners)
      }
    }

    const report = [...missing.entries()].map(
      ([scope, owners]) => `${scope}（如 ${owners.join('、')}）`
    )
    expect(report, [
      '以下 revision scope 没有被宿主快照发布，模型永远给不出期望值：',
      ...report,
      '这些属性声明可写但实际写不了，会报 EXPECTED_REVISION_REQUIRED 且无从恢复。',
      '把 scope 加进 hostContext.ts 的 scopeRevisions，并从该领域的权威计数拉取。',
    ].join('\n')).toEqual([])
  })

  it('每个可写实体都能映射到一个宿主发布得出来的并发作用域', () => {
    /*
     * 上一条守"provider 要的 scope 宿主发布得出来"，这条守链路的另一半：
     * **通用写入动词得先认出这个实体属于哪个 scope**。
     *
     * `change_application_entities` 用一张手写前缀表（`mutationScope`）把 entityType 映射成
     * 宿主作用域，漏一条不会报"没映射"，而是退化成兜底四域——于是计划器要的那个 scope 谁都
     * 没给，最终 `EXPECTED_REVISION_REQUIRED`，且没有恢复路径。表已经漂移过两轮，所以这里
     * 直接遍历注册表里每个可写实体，逼它对上。
     */
    const registry = getApplicationReflectionRegistry()
    const description = registry.describe({}, {
      exposure: 'assistant',
      permissions: new Set(registry.listDeclaredPropertyPermissions()),
      acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
    })
    const writableEntityTypes = [...new Set(
      description.properties.filter((p) => !p.readOnlyReason).map((p) => p.entityType)
    )]
    expect(writableEntityTypes.length, '可写实体数塌了，下面的遍历会假绿').toBeGreaterThan(5)

    const published = new Set(Object.keys(createHostContextSnapshot().scopeRevisions))
    /*
     * 走能力自己的 `resolveRequiredScopes`，不导出内部的 mutationScope——门禁必须和生产
     * 同一条路，否则守的是一份平行实现。认不出实体时它会退化成一组兜底作用域，
     * 所以"返回了多个 scope"就是"没认出来"的信号。
     */
    const changeEntities = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES
      .find((capability) => capability.id === 'change_application_entities')
    expect(changeEntities?.resolveRequiredScopes, '通用写入动词没有作用域解析').toBeTruthy()

    const broken = writableEntityTypes.flatMap((entityType) => {
      const scopes = changeEntities?.resolveRequiredScopes?.({
        summary: '门禁探测',
        changes: [{ kind: 'set_properties', entityType, target: { kind: entityType, id: 'probe' }, properties: {} }],
      } as never) ?? []
      if (scopes.length !== 1) {
        return [`${entityType} → 没认出来，退化成兜底作用域 [${scopes.join('、')}]，写入必然拿不到基线`]
      }
      const scope = scopes[0]
      if (!published.has(scope) && !(scope in KNOWN_UNPUBLISHABLE)) {
        return [`${entityType} → ${scope}（映射有了，但宿主没发布这个 scope）`]
      }
      return []
    })

    expect(broken, [
      '以下可写实体在通用写入路径上拿不到并发基线，声明可写但实际写不了：',
      ...broken,
      '在 applicationReflectionApplicationCapabilities.ts 的 mutationScope 里补上映射，',
      '并确认 hostContext.ts 的 scopeRevisions 发布了对应 scope。',
    ].join('\n')).toEqual([])
  })

  it('登记为发布不出来的 scope，一旦发布了就必须销账', () => {
    const published = new Set(Object.keys(createHostContextSnapshot().scopeRevisions))
    const stale = Object.keys(KNOWN_UNPUBLISHABLE).filter((scope) => published.has(scope))
    expect(stale, [
      '以下 scope 已经发布了，但还挂在 KNOWN_UNPUBLISHABLE 里，账没销：',
      ...stale,
    ].join('\n')).toEqual([])
  })

  it('发布出来的值来自权威计数，不是恒为 0 的占位', () => {
    /*
     * 只加键不接数据源同样是假的：期望值永远是 0，而执行器返回的是真实 revision，
     * 第二次写入必然 CONFLICT。这条确认几个已知有真实来源的 scope 至少能读出来。
     */
    const snapshot = createHostContextSnapshot()
    for (const scope of ['generation_draft', 'models']) {
      expect(
        typeof snapshot.scopeRevisions[scope],
        `${scope} 必须发布成数字，缺失说明只加了 schema 没接数据源`,
      ).toBe('number')
    }
  })
})
