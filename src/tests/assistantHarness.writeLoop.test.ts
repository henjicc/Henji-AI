// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import type { ApplicationMutationExecutor } from '@/core/application-control'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

import { runAssistantHarness } from './assistantRuntimeHarness'

/**
 * 读改验回环的**全域穷举**：每个写域都走一遍「读当前值 → 写新值 → 读回来对账」。
 *
 * 与领域自己的执行器单测（`resultBehaviorCoverage` 登记的那批）分工清楚：那些直接调
 * `applicationReflectionHandlers`，隔离验证适配器与执行器；这里从**模型的位置**出发，
 * 经能力发现 → 脚本租约 → Henji Script 解释器 → Gateway（权限/revision/Effect Receipt）
 * → 反射适配器 → 执行器 → 真相源。中间那一大段只有这一层覆盖得到。
 *
 * 对账用脚本内的 `app.entities.read` + `app.assert.equal`——规则明确允许 `readEntity` 作为
 * 真相源断言，而且它走的正是模型自己会走的那条读回路径。写完不读回等于只信执行器说"我写了"。
 */

interface WriteLoop {
  domain: string
  entityType: string
  /**
   * 发现请求里点名的实体。
   *
   * 不能只写目标实体：`capability-discovery` 有一条刻意的抑制——请求点名的实体**全部**被某条
   * Recipe 覆盖时，`scriptApi.actions` 会整个清空，只给 Recipe（为的是压投影体积）。于是
   * 只点 `canvas.project` 时连 `create_canvas_project` 都拿不到，脚本报"本次租约没有任何能力"。
   * 这不是缺陷，是既定取舍；但用例得按真实形状点名，多带一个 Recipe 覆盖不到的实体即可。
   */
  discoverEntityTypes?: string[]
  /** 产出名为 `ref` 的变量；单例域留空。 */
  seed: string
  ref: string
  property: string
  /** 写进去的新值（脚本字面量）。 */
  value: string
  /** 可选：从 zustand 真相源再确认一次，比 readEntity 更硬。 */
  assertStore?: () => void
}

const LOOP_NONCE = 'harness-写回环'

/**
 * 暂时够不到实例的实体。**只许变短**，与其他欠账清单同一性质。
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  image_mark: '标注文档要先打开图片编辑器会话，而会话需要一个真实素材源；'
    + 'jsdom 下没有素材落盘，够不到实例。执行器层由 imageMarkReflection.test.ts 覆盖，'
    + '缺的是"经模型链路"那一段，需要先让 harness 能造出素材。'
    + '注意该域还有一条更硬的阻塞：并发基线发布不出来，见 hostScopeCoverage.test.ts 的 KNOWN_UNPUBLISHABLE。',
  /*
   * assets 与 camera_stage 卡在同一处：创建实例要经 platform 持久化，而 jsdom 下
   * `getPlatform()` 直接抛 `Platform runtime is only available inside the Electron desktop shell`，
   * 事务整体补偿回滚。
   *
   * **这是环境限制，不是链路缺陷**——两个域的真机场景每次都跑通，判据见 assistant:live:suite。
   * 而且它卡在创建实例那一步，前面的能力发现、租约、脚本编译、Gateway 准入全都走通了。
   *
   * 解锁路径明确：给 harness 装一个只存内存的 `window.henjiNative` 替身，让 `detectShell()`
   * 认出 shell。它属于替身白名单里的"持久化"一类，不含任何业务判断。没有现在就做，是因为
   * platform 有 22 个子适配器，替身要么按需最小化（碰到没实现的方法必须**抛错而不是返回
   * 空值**，否则就成了悄悄伪造业务结果），要么就会滑成一份平行的假 platform。
   */
  assets: 'jsdom 下 platform 持久化不可用，创建素材库时事务整体回滚；需给 harness 装最小内存 platform 替身',
  camera_stage: 'jsdom 下 platform 持久化不可用，创建 3D 工程时同样回滚；与 assets 同一处阻塞、同一条解锁路径',
}

function loops(): WriteLoop[] {
  return [
    {
      domain: 'settings', entityType: 'settings.registry', seed: '',
      ref: "{ kind: 'settings.registry', id: 'singleton' }",
      property: 'interface.theme_tone',
      value: "'cool'",
      assertStore: () => expect(useSettingsStore.getState().themeTonePreset).toBe('cool'),
    },
    {
      domain: 'generation', entityType: 'generation.draft', seed: '',
      ref: "{ kind: 'generation.draft', id: 'singleton' }",
      property: 'generation.draft.prompt_text',
      value: `'${LOOP_NONCE}'`,
    },
    {
      domain: 'canvas', entityType: 'canvas.project',
      // 多带 node_type：canvas.image_pipeline 覆盖不到它，action 才会正常投影。
      discoverEntityTypes: ['canvas.project', 'canvas.node_type'],
      seed: [
        `const created = await app.action('create_canvas_project', { name: '${LOOP_NONCE}-画布' });`,
        "const ref = { kind: 'canvas.project', id: created.projectId };",
      ].join('\n'),
      ref: 'ref',
      property: 'canvas.project.name',
      value: `'${LOOP_NONCE}-画布改名'`,
      assertStore: () => expect(useProjectStore.getState().currentProject?.name)
        .toBe(`${LOOP_NONCE}-画布改名`),
    },
    {
      domain: 'models', entityType: 'generation.model',
      seed: [
        "const listed = await app.entities.list('generation.model');",
        'app.assert.exists(listed.refs);',
        'const ref = listed.refs[0];',
      ].join('\n'),
      ref: 'ref',
      property: 'generation.model.hidden',
      value: 'true',
    },
  ]
}

function loopScript(loop: WriteLoop): string {
  return [
    loop.seed,
    `const before = await app.entities.read(${loop.ref}, ['${loop.property}']);`,
    'app.assert.exists(before);',
    `await app.entities.update(${loop.ref}, { '${loop.property}': ${loop.value} });`,
    `const after = await app.entities.read(${loop.ref}, ['${loop.property}']);`,
    `app.assert.equal(after.properties['${loop.property}'], ${loop.value});`,
  ].filter(Boolean).join('\n')
}

/** 有写入执行器的域，用来核对上面的清单没有漏域。 */
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
    description.entities.filter((entity) => entityTypes.has(entity.id)).map((entity) => entity.domain)
  )].sort()
}

describe('读改验回环的全域穷举', () => {
  let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']

  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  beforeEach(() => {
    originalTone = useSettingsStore.getState().themeTonePreset
    useProjectStore.setState({
      projects: [], currentProjectId: null, currentProject: null, isHydrated: true,
    })
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })

  afterEach(() => {
    useSettingsStore.getState().setThemeTonePreset(originalTone)
  })

  it('清单覆盖了每个写域，缺的必须登记原因', () => {
    const covered = new Set(loops().map((loop) => loop.domain))
    const missing = writableDomains()
      .filter((domain) => !covered.has(domain))
      .filter((domain) => !(domain in KNOWN_UNREACHABLE))

    expect(missing, [
      '以下写域没有读改验回环，也没有登记原因——它们的"经模型链路写入"从未被验证过：',
      ...missing,
      '补一条 WriteLoop，或登记进 KNOWN_UNREACHABLE 并写明够不到实例的具体原因。',
    ].join('\n')).toEqual([])
  })

  it('登记为够不到的域，一旦补上回环就必须销账', () => {
    const covered = new Set(loops().map((loop) => loop.domain))
    const stale = Object.keys(KNOWN_UNREACHABLE).filter((domain) => covered.has(domain))
    expect(stale, `以下域已经有回环了，账没销：${stale.join('、')}`).toEqual([])
  })

  /*
   * 合成一条用例逐域跑，而不是 it.each：每个域都要真跑一次能力发现，拆成独立用例会把
   * harness 的启动成本乘以域数。合成之后全域仍在秒级。
   */
  it('每个写域：读当前值 → 写新值 → 读回来都对得上', async () => {
    const failures: string[] = []
    for (const loop of loops()) {
      const result = await runAssistantHarness({
        goal: `${loop.domain} 读改验回环`,
        steps: [
          {
            actions: [{
              type: 'tool_call',
              toolCall: {
                toolCallId: 'call-discover',
                toolName: 'discover_application_capabilities',
                input: {
                  queries: [`${loop.domain} 域读改验`],
                  domains: [loop.domain],
                  entityTypes: loop.discoverEntityTypes ?? [loop.entityType],
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
                  summary: `${loop.domain} 回环`,
                  source: loopScript(loop),
                },
                dynamic: false,
              },
            }],
          },
          { actions: [{ type: 'text', value: '回环完成。' }] },
        ],
      })

      const discovery = result.toolCalls.find(
        (call) => call.toolName === 'discover_application_capabilities'
      )
      if (!discovery?.ok) {
        failures.push(`${loop.domain}：能力发现失败 → ${discovery?.errorCode} ${discovery?.errorMessage}`)
        continue
      }
      if (result.state.status === 'failed') {
        failures.push(`${loop.domain}：整次运行失败 → ${JSON.stringify(result.state.error).slice(0, 200)}`)
        continue
      }
      const scriptCall = result.toolCalls.find((call) => call.toolName === 'run_henji_script')
      if (!scriptCall?.ok) {
        failures.push(`${loop.domain}：回环脚本被拒 → ${scriptCall?.errorCode} ${String(scriptCall?.errorMessage).slice(0, 220)}`)
        continue
      }
      /*
       * 写域必须看到对应 scope 的 revision 推进。没推进说明写入没走正式链路——
       * 那种情况下 readEntity 也可能读到"写进内存但没进真相源"的假值。
       */
      const anyRevision = Object.values(result.finalHostContext.scopeRevisions)
        .some((value) => value > 0)
      if (!anyRevision) failures.push(`${loop.domain}：写入后没有任何 revision 推进`)

      try {
        loop.assertStore?.()
      } catch (error) {
        failures.push(`${loop.domain}：真相源对账失败 → ${(error as Error).message.slice(0, 200)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 120_000)
})
