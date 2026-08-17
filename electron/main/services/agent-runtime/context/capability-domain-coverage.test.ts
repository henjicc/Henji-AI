import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { APPLICATION_CAPABILITY_CATEGORIES } from '../tools/builtin/backend'
import { AGENT_ROUTE_POLICY } from './router'
import { AGENT_TOOL_DOMAINS } from './types'

/**
 * 门禁：**域这个词，从注册到路由到工具契约必须处处对得上。**
 *
 * `capability-reachability.test.ts` 守的是"注册好的能力找得到"，但它遍历的 `domains` 是
 * **从能力自身推导**的——等于拿模型没有的知识去问发现层。于是有一整类缺口它结构上看不见：
 * 域名根本没进过工具契约和路由，模型没有任何途径学到这个词。
 *
 * 实测抓到的就是这一类：`image_mark` 注册了两条能力（undo/redo 标注文档），但既不在
 * `AGENT_TOOL_DOMAINS`（于是不在 `search_application_capabilities` 的分类枚举里），也不被任何
 * intent 的 `toolDomains` 锚定。模型想改标注只能猜域名，而它会猜成 `image_edit`——那是同一个
 * Surface 上的另一个域。这与设置域那次事故同形状（`application.setting` vs `settings.registry`，
 * 一次改设置从 5 回合 3.8 万 token 变成 18 回合 25 万）。
 *
 * 三条断言合起来是一个完整命题：**模型说得出的域背后有东西，注册了的域模型说得出，
 * 且每个域都有一条路由能把模型带过去。**
 */

/**
 * 已知的空分类。每条必须写明：为什么是空的、由谁补、补进来之后这条要删掉。
 *
 * 只许变短，与 `ASSISTANT_BLIND_FEATURES` / `ASSISTANT_BLIND_STORES` 同一性质：是欠账清单，
 * 不是豁免表。留一个永远选不出东西的分类，代价是模型每次都要花一轮才发现此路不通。
 */
const KNOWN_EMPTY_DOMAINS: Record<string, string> = {
  /*
   * **空清单是正常状态，不是待填的模板。**
   *
   * 这里曾经挂着 `workflows`：分类、路由意图、实体映射（`workflow.definition` /
   * `workflow.run`）与域覆盖评测用例（`list_workflows`，那个工具名同样不存在）一应俱全，
   * 唯独从来没有过一条能力——而应用里根本不存在工作流功能，`src/features/` 下没有这个目录。
   * 那是一次为不存在的功能做的投机注册，代价是模型被路由过去、拿到空目录，
   * 然后如实回答"应用没有这个能力"。
   *
   * 按这条门禁自己给的出路二选一，选了删：分类、路由意图、确定性规则、实体映射、权限映射、
   * Surface 映射与评测用例一并移除。往这里加新条目之前，先确认那个域的功能真的存在。
   */
}

/**
 * 不需要被任何 intent 路由的域：它们是**核心常驻**工具，不参与目录轮换，永远在活动集里。
 *
 * 见 `AGENT_CORE_TOOL_NAMES`——通用动词、能力发现、技能加载、产物回读本来就不经过发现与路由。
 */
const ALWAYS_ON_DOMAINS = new Set<string>(['application', 'artifacts'])

function fullContext(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-domain-coverage',
    revision: 5,
    scopeRevisions: { navigation: 2, generation: 1, canvas: 3, toolbox: 4, assets: 1 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    surface: { id: 'tool.camera_stage', kind: 'tool', focusedRef: null, selectedRefs: [] },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: registry.allDefinitions()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.name),
    capturedAt: new Date().toISOString(),
  }
}

function buildRegistry(): ReturnType<typeof createBuiltinAgentToolRegistry> {
  return createBuiltinAgentToolRegistry(async () => {
    throw new Error('测试不执行前端工具')
  })
}

function countByDomain(): Map<string, number> {
  const registry = buildRegistry()
  const listed = registry.list(fullContext(registry))
  // 防空转：目录规模掉到这个数以下说明注册链路本身出问题了，下面的遍历会假绿。
  expect(listed.length).toBeGreaterThan(60)
  const counts = new Map<string, number>()
  for (const entry of listed) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  return counts
}

describe('能力域覆盖', () => {
  it('模型选得到的每个域背后都有已注册能力，例外必须登记原因', () => {
    const counts = countByDomain()
    const emptyDomains = APPLICATION_CAPABILITY_CATEGORIES
      .filter((domain) => (counts.get(domain) ?? 0) === 0)
      .filter((domain) => !(domain in KNOWN_EMPTY_DOMAINS))

    expect(emptyDomains, [
      '以下域模型选得到、背后却一个能力都没有——它会拿到空目录，然后如实回答"应用没有这个能力"：',
      ...emptyDomains,
      '要么注册能力，要么把域连同路由意图与评测用例一起删掉；确实要暂时留空就登记进 KNOWN_EMPTY_DOMAINS 并写明谁来补。',
    ].join('\n')).toEqual([])
  })

  it('注册了能力的每个域，模型都说得出它的名字', () => {
    const counts = countByDomain()
    const declared = new Set<string>(AGENT_TOOL_DOMAINS)

    /*
     * 反向的同一件事。前端能力的 category 直接取 `definition.domain`
     * （见 frontend-capabilities.adaptCapability），所以新增领域时漏改 AGENT_TOOL_DOMAINS
     * 不会有任何编译错误——能力注册好了，模型却没有词可以指称它。
     */
    const unnamed = [...counts.entries()]
      .filter(([domain]) => !declared.has(domain))
      .map(([domain, count]) => `${domain}（${count} 项能力）`)

    expect(unnamed, [
      '以下域注册了能力，但不在 AGENT_TOOL_DOMAINS 里——它进不了工具契约的分类枚举，',
      '模型没有任何途径学到这个域名，只会猜一个相邻的名字然后撞空：',
      ...unnamed,
      '把域名加进 context/types.ts 的 AGENT_TOOL_DOMAINS，并确认至少有一条 intent 路由能到达它。',
    ].join('\n')).toEqual([])
  })

  it('每个域都至少被一条路由意图锚定，常驻域除外', () => {
    const routed = new Set<string>(
      Object.values(AGENT_ROUTE_POLICY).flatMap((policy) => policy.toolDomains)
    )

    /*
     * 域进了工具契约但没有任何 intent 指向它，模型仍然只能靠自己猜到域名再手写进 discovery 请求。
     * 锚点工具集是模型"不用发现就已经握在手里"的那一批，域不在任何路由里 = 永远进不了锚点。
     */
    const unrouted = AGENT_TOOL_DOMAINS
      .filter((domain) => !routed.has(domain))
      .filter((domain) => !ALWAYS_ON_DOMAINS.has(domain))

    expect(unrouted, [
      '以下域没有任何 intent 会路由过去，模型只能靠猜到域名才发现得到：',
      ...unrouted,
      '把域加进 context/router.ts 的 AGENT_ROUTE_POLICY 里某条相关 intent 的 toolDomains；',
      '确实是核心常驻工具（不参与目录轮换）就加进 ALWAYS_ON_DOMAINS 并说明理由。',
    ].join('\n')).toEqual([])
  })

  it('登记的空域一旦补上能力就必须销账，且必须是真实域名', () => {
    const counts = countByDomain()
    const declared = new Set<string>(AGENT_TOOL_DOMAINS)

    // 清单只许变短。补齐了却忘了销账，下一个人看到的就是一份说谎的清单。
    const stale = Object.keys(KNOWN_EMPTY_DOMAINS)
      .filter((domain) => (counts.get(domain) ?? 0) > 0)
      .map((domain) => `${domain}（现有 ${counts.get(domain)} 项能力，该销账了）`)
    const unknown = Object.keys(KNOWN_EMPTY_DOMAINS)
      .filter((domain) => !declared.has(domain))
      .map((domain) => `${domain}（不是真实域名，多半是域改名或删除后忘了同步）`)

    expect([...stale, ...unknown], [
      'KNOWN_EMPTY_DOMAINS 与实际注册对不上：',
      ...stale,
      ...unknown,
    ].join('\n')).toEqual([])
  })
})
