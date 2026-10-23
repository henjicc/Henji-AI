import { ApplicationPreflightFailure, ApplicationTransactionFailure } from './transactionFailure'
import { ApplicationPersistenceFailure } from './persistence'
import { isRejectedBeforeWrite } from './rejectionErrors'
import type { ApplicationEffectReceipt } from '../transactions'

export interface ApplicationWriteFacts {
  billing: 'not_charged' | 'submitted' | 'completed' | 'unknown'
  targetMutation: 'none' | 'applied' | 'unknown'
  audioDocumentId?: string
}

/** 所有 handler 的失败共用这份事实，领域错误只作为 cause 保留。 */
export class ApplicationWriteFailure extends Error {
  constructor(readonly original: unknown, readonly execution: ApplicationWriteFacts & { notExecuted: boolean },
    readonly effects: ApplicationEffectReceipt[] = []) {
    super(original instanceof Error ? original.message : String(original), { cause: original })
    this.name = 'ApplicationWriteFailure'
  }
}

/** 每次调用独有，不能把“进入 handler”当作“已写入”，也不能从异常文案猜执行事实。 */
export class ApplicationWriteExecution {
  constructor(private readonly mutationReview = true) {}
  private started = false
  private completed = false
  private facts: ApplicationWriteFacts = { billing: 'not_charged', targetMutation: 'none' }
  private effects: ApplicationEffectReceipt[] = []

  report(facts: Partial<ApplicationWriteFacts>, effects: ApplicationEffectReceipt[] = []): void {
    const { billing, targetMutation } = this.facts
    this.facts = { ...this.facts, ...facts,
      ...(billing === 'completed' ? { billing } : {}), ...(targetMutation === 'applied' ? { targetMutation } : {}) }
    this.effects.push(...effects)
  }

  /** 验证、引用解析、授权与费用确认；禁止在这个回调内改变业务状态。 */
  async preflight<T>(prepare: () => T | Promise<T>): Promise<T> {
    try { return await prepare() } catch (error) {
      if (this.completed || this.facts.billing !== 'not_charged' || this.facts.targetMutation !== 'none' || this.effects.length) throw error
      throw new ApplicationPreflightFailure(error)
    }
  }

  /** 唯一业务派发边界。成功之后的输出校验失败也保留已经执行的事实。 */
  async run<T>(execute: () => T | Promise<T>): Promise<T> {
    this.started = true
    const result = await execute()
    this.completed = true
    this.report({ targetMutation: 'applied' })
    return result
  }

  async paid<T>(execute: () => T | Promise<T>): Promise<T> {
    this.started = true
    this.report({ billing: 'submitted' })
    const result = await execute()
    this.report({ billing: 'completed' })
    return result
  }

  /** 仅供无外部副作用的不可变文档算法：正式文档身份就是原子提交事实。 */
  async atomic<T>(snapshot: () => unknown, execute: () => T | Promise<T>): Promise<T> {
    const before = snapshot()
    try { return await execute() } catch (error) {
      if (error instanceof ApplicationPersistenceFailure || error instanceof ApplicationTransactionFailure || error instanceof ApplicationWriteFailure) throw error
      let unchanged = false
      try { unchanged = snapshot() === before } catch { throw error /* 实例已失效，不能推断任何目标变化。 */ }
      if (!unchanged) this.report({ targetMutation: 'applied' })
      throw new ApplicationWriteFailure(error, { ...this.facts,
        notExecuted: unchanged && this.facts.targetMutation === 'none' && this.facts.billing === 'not_charged' && !this.effects.length }, this.effects)
    }
  }

  failure(error: unknown): unknown {
    // 导航即使改变了视图，也没有待核实的业务修改，不阻挡下一次打开。
    if (!this.mutationReview) return new ApplicationWriteFailure(error, { billing: 'not_charged', targetMutation: 'none', notExecuted: true })
    // 事务引擎与保存协调器的结构化回执比本层阶段更精确，不覆盖或降为字符串。
    if (error instanceof ApplicationTransactionFailure || error instanceof ApplicationPersistenceFailure) {
      if (this.facts.billing !== 'not_charged' || this.facts.targetMutation !== 'none' || this.effects.length) {
        return new ApplicationWriteFailure(error, { ...this.facts, notExecuted: false }, this.effects)
      }
      return error
    }
    if (error instanceof ApplicationWriteFailure) {
      this.report(error.execution, error.effects)
      return new ApplicationWriteFailure(error.original, { ...this.facts,
        notExecuted: error.execution.notExecuted && !this.completed && this.facts.billing === 'not_charged' && this.facts.targetMutation === 'none' && !this.effects.length }, this.effects)
    }
    // 领域错误显式声明未执行（如画布“没有可停止的本地执行”），或抛出的是约定只在写入前出现的拒绝类型（位置无效、重名、不存在……），
    // 同样是前置拒绝；仍须同时满足无修改、未计费、无副作用。
    const details = error && typeof error === 'object' ? (error as { details?: { execution?: { notExecuted?: unknown } } }).details : undefined
    const rejected = !this.completed && (error instanceof ApplicationPreflightFailure || details?.execution?.notExecuted === true || isRejectedBeforeWrite(error))
    const notExecuted = (!this.started || rejected) && this.facts.billing === 'not_charged' && this.facts.targetMutation === 'none' && !this.effects.length
    return new ApplicationWriteFailure(error, { ...this.facts, notExecuted,
      // none 是准备阶段的初值，进入派发后缺回执不能把它当成已确认的零修改。
      ...(!notExecuted && this.facts.billing === 'not_charged' && this.facts.targetMutation === 'none' ? { targetMutation: 'unknown' as const } : {}),
    }, this.effects)
  }
}

/**
 * 领域在任何业务写入之前就失败（样片代码编译不过、来源文件夹缺失、复制失败但已清理干净）时用它包装再抛出：
 * 明确告诉执行层这次没有改动任何东西，调用方修正后可以直接用新的操作标识重试，不必请用户核对。
 * 只有确实没有写入、没有计费、没有其他副作用时才能用。
 */
export function notExecutedFailure(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error))
  const details = (failure as { details?: Record<string, unknown> }).details
  return Object.assign(failure, { details: { ...details, execution: { notExecuted: true } } })
}

const channels = new WeakSet<object>()

/** 领域分阶段操作使用同一个包装；准备阶段不调用 run/paid，异常自动为零执行。 */
export async function executeApplicationWrite<T>(work: (execution: ApplicationWriteExecution) => T | Promise<T>, mutationReview = true): Promise<T> {
  const execution = new ApplicationWriteExecution(mutationReview)
  try { return await work(execution) } catch (error) { throw execution.failure(error) }
}

/** 注册器只保存此工厂产出的写 handler；调用者拿不到未包装的 handler。 */
export function applicationWriteChannel<TInput, TContext, TResult>(handler: (input: TInput, context: TContext & { execution: ApplicationWriteExecution }) => TResult | Promise<TResult>, mutationReview = true):
  (input: TInput, context: TContext) => Promise<TResult> {
  const wrapped = async (input: TInput, context: TContext): Promise<TResult> => {
    return executeApplicationWrite(execution => execution.run(() => handler(input, { ...context, execution })), mutationReview)
  }
  channels.add(wrapped)
  return wrapped
}

export function assertApplicationWriteChannel(id: string, handler: object): void {
  if (!channels.has(handler)) throw new Error(`WRITE_EXECUTION_REQUIRED:${id} 必须由 applicationWriteChannel 包装后注册，前置检查使用 execution.preflight，副作用阶段使用 execution.report。`)
}

/** 领域适配器与直接调用测试共用的准备边界，不依赖是否装配了公共注册器。 */
export async function applicationWritePreflight<T>(context: { execution?: ApplicationWriteExecution }, prepare: () => T | Promise<T>): Promise<T> {
  return (context.execution ?? new ApplicationWriteExecution()).preflight(prepare)
}
