/*
 * 界面动作账本：**人在界面上能做的每一件事，助手要么也能做，要么写明为什么不能。**
 *
 * 现有的覆盖门禁全部从「已注册的描述」出发做双向比对，从不反向看 store/UI。于是三维场景外观
 * 24 项界面能改、助手一项都看不到这件事，没有任何检查能发现——不是被权限挡住，是根本没注册，
 * 通用动词看不见它们，助手安静地少了一整块能力，直到用户实测才发现。同类事故已经发生多次。
 *
 * 此前唯一的反向门禁靠 `setSceneXxx → xxx` 的命名约定推导，只对那一组成立：`updateShotTiming`、
 * `bakeToProMode`、`play`、`clearTrack` 没有任何可推导的映射。所以保留方向（从 store 枚举，
 * 不从注册表自证），把推导方式换成显式账本。
 *
 * 三层保证，各堵一个洞：
 * - 类型层：`Record<TAction, …>` 让 store 新增动作而没建账**在 tsc 阶段**就点名缺哪个 key
 * - 测试层：审计绑定是否指得实、理由是否可验证、销账是否干净
 * - 脚本层：整个 feature 从来没建过账（imageMark 那种全域失明）由 cjs 门禁清点
 */

/** 有意不开放写入的类别。选哪一类决定了理由该怎么写，也让统计能按类别看差集。 */
export type ApplicationExclusionCategory =
  /** 纯视图：手柄模式、四窗布局、面板宽度。不进工程文件，不影响产物。 */
  | 'view_state'
  /** 选中、悬浮、展开这类鼠标操作的中间产物。助手用稳定引用直接寻址，不需要先"选中"。 */
  | 'transient_selection'
  /** 由别的写入派生出来的，自己不是用户入口（例如播放循环回填的当前时间）。 */
  | 'derived'
  /** 不是用户动作：持久化回填、被别的 action 内部调用的私有步骤。 */
  | 'internal'
  /** 只能由用户在系统级 UI 完成——系统文件选择器、密钥输入框。渲染层无法代劳。 */
  | 'user_only'

/**
 * 一个 store 动作对应到助手侧的什么。
 *
 * 注意 `excluded` 表达的是**不可写**，不是**不可见**。视图态助手仍然要读得到——它得知道用户
 * 现在在看什么，这对多轮协作是必需的。屏蔽读取是另一回事，不由这里表达。
 */
export type ApplicationStoreActionBinding =
  | { kind: 'property'; propertyIds: readonly [string, ...string[]] }
  | { kind: 'collection'; entityType: string; operation: 'create' | 'remove' | 'reorder' }
  | { kind: 'capability'; capabilityId: string }
  | { kind: 'excluded'; category: ApplicationExclusionCategory; reason: string }
  /**
   * **人能做、助手还不能做，而且这不合理。**
   *
   * 这一档存在的唯一理由是不让"还没补"和"有意不开放"混成一谈。硬要求每条都归入前四类，
   * 只会逼人给真实缺口编一个假的排除理由——那正是这套账本要防的事。
   *
   * 它是一个棘轮：汇总门禁盯住总数不许涨（新缺口进不来），各期补齐把它往下烧。
   * 烧到零就是"助手能做的事等于人能做的事"。
   */
  | { kind: 'gap'; plannedPhase: string; reason: string }

export interface ApplicationStoreActionLedger<TAction extends string> {
  readonly storeId: string
  /** 中文名，进报错信息用。 */
  readonly title: string
  /**
   * `Record<TAction, …>` 而不是 `Partial<…>`：漏一条就是 tsc 编译错误，且直接点名缺哪个 key。
   * TAction 由各 feature 从 store 类型里推出来，不手写清单。
   */
  readonly entries: Readonly<Record<TAction, ApplicationStoreActionBinding>>
}

export interface ApplicationLedgerAuditInput {
  readonly ledger: ApplicationStoreActionLedger<string>
  /** 从真实 store 快照运行时枚举出来的函数键——手写清单会跟着漂移，失去反向验证的意义。 */
  readonly actionNames: readonly string[]
  /** 全体 mutation 执行器 writableProperties 的并集。 */
  readonly writableProperties: ReadonlySet<string>
  /** 声明了 collectionWrite 且真的有集合执行器的实体类型。 */
  readonly collectionEntityTypes: ReadonlySet<string>
  readonly capabilityIds: ReadonlySet<string>
}

export interface ApplicationLedgerProblem {
  readonly action: string
  readonly problem: string
}

export interface ApplicationLedgerAudit {
  /** store 有、账上没有。新增界面动作会从这里冒出来。 */
  readonly unclassified: string[]
  /** 账上有、store 没有。删了动作忘了销账。 */
  readonly stale: string[]
  /** 绑定指向的属性/实体/能力不存在，或指向的属性根本没有执行器能写——账是假的。 */
  readonly brokenBindings: ApplicationLedgerProblem[]
  /** 排除理由无法验证。gap 的理由同样按这条标准检查。 */
  readonly weakExclusions: ApplicationLedgerProblem[]
  /** 人能做、助手还不能做的动作。这个数字是补齐工作的燃尽基线，只许降不许升。 */
  readonly gaps: string[]
}

/*
 * 只匹配「把问题推到将来」的说法，不匹配「不需要」这类正常措辞——
 * "助手不需要先选中，因为它用稳定引用直接寻址"是一条说清了机制的好理由，
 * 而"暂时不需要"没有说明任何机制，将来也没人会回来看。
 */
const EVASIVE_REASON = /暂时|暂不|以后再|后续再|回头再|待定|再说|TODO/i
const MIN_REASON_LENGTH = 12

function auditBinding(
  action: string,
  binding: ApplicationStoreActionBinding,
  input: ApplicationLedgerAuditInput,
): ApplicationLedgerProblem | undefined {
  if (binding.kind === 'property') {
    /*
     * 这条检查把界面级账本和属性级门禁串了起来：账上写「updateShotTiming 对应
     * camera_stage.shot.time」，而属性级门禁知道执行器写不了 time —— 于是这里立刻红。
     * 单靠任何一道门禁都发现不了这个组合。
     */
    const missing = binding.propertyIds.filter((id) => !input.writableProperties.has(id))
    if (missing.length > 0) {
      return { action, problem: `${action} → ${missing.join('、')}（没有任何执行器能写这些属性）` }
    }
    return undefined
  }
  if (binding.kind === 'collection') {
    if (!input.collectionEntityTypes.has(binding.entityType)) {
      return { action, problem: `${action} → ${binding.entityType}（该实体没有声明 collectionWrite 或缺集合执行器）` }
    }
    return undefined
  }
  if (binding.kind === 'capability') {
    if (!input.capabilityIds.has(binding.capabilityId)) {
      return { action, problem: `${action} → ${binding.capabilityId}（不存在这个能力 id）` }
    }
    return undefined
  }
  return undefined
}

/**
 * excluded 与 gap 的理由用同一把尺子量。
 *
 * gap 也要写清楚缺的是什么、归到哪一期——否则它会退化成一句"以后再说"，账本就白建了。
 */
function auditReason(action: string, reason: string): ApplicationLedgerProblem | undefined {
  if (reason.length < MIN_REASON_LENGTH) {
    return { action, problem: `${action}：理由过短，说不清由谁维护或缺什么（${reason}）` }
  }
  if (EVASIVE_REASON.test(reason)) {
    return { action, problem: `${action}：理由含无法验证的表述（${reason}）` }
  }
  return undefined
}

export function auditStoreActionLedger(input: ApplicationLedgerAuditInput): ApplicationLedgerAudit {
  const booked = Object.keys(input.ledger.entries)
  const actual = new Set(input.actionNames)
  const brokenBindings: ApplicationLedgerProblem[] = []
  const weakExclusions: ApplicationLedgerProblem[] = []
  const gaps: string[] = []

  for (const [action, binding] of Object.entries(input.ledger.entries)) {
    const broken = auditBinding(action, binding, input)
    if (broken) brokenBindings.push(broken)
    if (binding.kind === 'excluded' || binding.kind === 'gap') {
      const weak = auditReason(action, binding.reason)
      if (weak) weakExclusions.push(weak)
    }
    if (binding.kind === 'gap') gaps.push(action)
  }

  return {
    unclassified: input.actionNames.filter((name) => !(name in input.ledger.entries)).sort(),
    stale: booked.filter((name) => !actual.has(name)).sort(),
    brokenBindings,
    weakExclusions,
    gaps: gaps.sort(),
  }
}
