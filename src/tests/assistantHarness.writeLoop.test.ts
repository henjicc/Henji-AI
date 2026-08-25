// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import type { ApplicationMutationExecutor } from '@/core/application-control'
import { createHostContextSnapshot } from '@/features/assistant/hostContext/hostContext'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { getPlatform } from '@/platform/runtime'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

import {
  installHarnessNativeStorage,
  resetHarnessNativeStorage,
  uninstallHarnessNativeStorage,
} from './harnessNativeStorage'
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
  /**
   * 可选：绕开 `readEntity` 再对一次账，比脚本内的 `app.assert.equal` 更硬。
   *
   * 该盯哪个真相源，取决于该域的 `readEntity` 读的是**哪一份**：读 zustand 的域（settings /
   * canvas）就盯 store；读持久化的域（assets）脚本回读本身就落到存储，不必重复。
   * 最需要这一条的是 camera_stage——它的 `readDomainSnapshot` 在工程已打开时直接返回
   * store，于是"改名没落到持久化"这类缺陷从脚本回读里完全看不出来。
   */
  assertTruthSource?: () => void | Promise<void>
}

const LOOP_NONCE = 'harness-写回环'

/**
 * 暂时够不到实例的实体。**只许变短**，与其他欠账清单同一性质。
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  image_mark: '标注文档要先打开图片编辑器会话，而会话需要一个真实素材源；'
    + 'harnessNativeStorage 目前只存素材集合，不存素材本身（素材还要经文件检查与缩略图，'
    + '那已经越过"只存不判断"这条线），够不到实例。执行器层由 imageMarkReflection.test.ts 覆盖，'
    + '缺的是"经模型链路"那一段。'
    + '而且**先解决 platform 也没用**：该域还有一条更硬的阻塞——并发基线发布不出来，'
    + '见 hostScopeCoverage.test.ts 的 KNOWN_UNPUBLISHABLE，那要改 provider 的并发模型。',
}

function loops(): WriteLoop[] {
  return [
    {
      domain: 'settings', entityType: 'settings.registry', seed: '',
      ref: "{ kind: 'settings.registry', id: 'singleton' }",
      property: 'interface.theme_tone',
      value: "'cool'",
      assertTruthSource: () => expect(useSettingsStore.getState().themeTonePreset).toBe('cool'),
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
      assertTruthSource: async () => {
        expect(useProjectStore.getState().currentProject?.name).toBe(`${LOOP_NONCE}-画布改名`)
        const persisted = await getPlatform().storyboardProjects.listProjectSummaries()
        expect(persisted.map((project) => project.name)).toContain(`${LOOP_NONCE}-画布改名`)
      },
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
    {
      /*
       * 素材集合是全域里唯一走「通用集合写入」创建的实例（其余域都靠专用 action），
       * 所以这条同时是 `app.entities.create` 经模型链路落到真相源的唯一覆盖。
       */
      domain: 'assets', entityType: 'asset.library',
      seed: [
        "const created = await app.entities.create('asset.library', {",
        "  parent: { kind: 'asset.catalog', id: 'default' },",
        `  properties: { 'asset.library.name': '${LOOP_NONCE}-素材集合' },`,
        '});',
        'const ref = created.resultRefs[0];',
      ].join('\n'),
      ref: 'ref',
      property: 'asset.library.name',
      value: `'${LOOP_NONCE}-素材集合改名'`,
    },
    {
      domain: 'camera_stage', entityType: 'camera_stage.project',
      // 多带 trajectory：camera_stage.state_animation 这条 Recipe 覆盖不到它，action 才会正常投影。
      discoverEntityTypes: ['camera_stage.project', 'camera_stage.trajectory'],
      seed: [
        `const created = await app.action('create_camera_stage_project', { name: '${LOOP_NONCE}-三维' });`,
        "const ref = { kind: 'camera_stage.project', id: created.projectId };",
      ].join('\n'),
      ref: 'ref',
      property: 'camera_stage.project.name',
      value: `'${LOOP_NONCE}-三维改名'`,
      assertTruthSource: async () => {
        expect(useCameraStageStore.getState().currentProjectName).toBe(`${LOOP_NONCE}-三维改名`)
        /*
         * 还要盯持久化那一份。三维改名同时写 store 和工程记录，而脚本回读只看得到 store
         * （工程已打开时 `readDomainSnapshot` 直接返回 store），持久化那半边没有任何东西盯着：
         * 存储层的 rename 是一条裸 UPDATE，id 传错就是静默零行，回读照样绿。
         */
        const persisted = await getPlatform().cameraStageProjects.listProjectSummaries()
        expect(persisted.map((project) => project.name)).toContain(`${LOOP_NONCE}-三维改名`)
      },
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

/**
 * 目标实体**自己声明**的并发作用域。
 *
 * 不写死映射：写死的那份是第二把尺子，实体改挂作用域时它不会跟着变，于是断言会在错误的
 * 计数器上一路绿灯。这里取的就是通用写入计划器拿来要期望值的同一份声明。
 */
function declaredRevisionScopes(entityType: string): string[] {
  const registry = getApplicationReflectionRegistry()
  const description = registry.describe({}, {
    exposure: 'assistant',
    permissions: new Set(registry.listDeclaredPropertyPermissions()),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
  })
  const entity = description.entities.find((item) => item.id === entityType)
  if (!entity) throw new Error(`${entityType} 没有出现在反射注册表里，回环的目标实体写错了。`)
  return [...entity.revisionScopes]
}

describe('读改验回环的全域穷举', () => {
  let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']

  beforeAll(async () => {
    /*
   * 装上只存内存的 native 替身。assets、canvas 与 camera_stage 创建实例都要落持久化，缺了它
   * `getPlatform()` 直接抛，事务整体补偿回滚——这也是相关域曾经登记在 KNOWN_UNREACHABLE
     * 里的原因。替身只换掉 IPC 之后那台 SQLite，电子适配器与领域链路仍是真的。
     */
    installHarnessNativeStorage()
    await loadRealModelsIntoRegistry()
  })

  afterAll(() => { uninstallHarnessNativeStorage() })

  beforeEach(() => {
    resetHarnessNativeStorage()
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
      const scopes = declaredRevisionScopes(loop.entityType)
      const before = createHostContextSnapshot().scopeRevisions
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
       * 写域必须看到**目标实体自己声明的那个** scope 推进。没推进说明写入没走正式链路——
       * 那种情况下 readEntity 也可能读到"写进内存但没进真相源"的假值。
       *
       * 盯本域的 scope 而不是"任意一个 scope 大于 0"：后者在第一个域写完之后就恒真了
       * （revision 是进程内累计的全局计数器），剩下的域实际上没有任何东西盯着。
       */
      const after = result.finalHostContext.scopeRevisions as Record<string, number>
      const advanced = scopes.filter((scope) => (after[scope] ?? 0) > ((before as Record<string, number>)[scope] ?? 0))
      if (advanced.length === 0) {
        failures.push(
          `${loop.domain}：写入后声明的 revision scope（${scopes.join('、')}）一个都没推进，`
          + `写入多半没走正式链路。`
        )
      }

      try {
        await loop.assertTruthSource?.()
      } catch (error) {
        failures.push(`${loop.domain}：真相源对账失败 → ${(error as Error).message.slice(0, 200)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 120_000)
})
