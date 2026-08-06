import type { ApplicationPropertyMutation } from '../transactions'

/**
 * 属性写入表：把「哪条属性能写、支持哪些 operation、怎么写」收敛成一张可被机器读取的表。
 *
 * 存在的理由是一个已经发生的事故：`camera_stage.shot.time` 在反射层声明为可写，而执行器里那条
 * 手写 if-else 链**没有 time 分支**——助手改镜头时间点必然拿到 PROPERTY_NOT_WRITABLE，而覆盖门禁
 * 只到实体粒度（shot 有 mutation 执行器就算过），全绿了不知道多久。手写链条对门禁是不透明的：
 * 它无法枚举「这个执行器到底能写哪些属性」。
 *
 * 表驱动之后这个集合可以直接读出来（writableProperties），门禁就能和反射层声明做双向比对。
 */
export type ApplicationMutationOperation = ApplicationPropertyMutation['operation']

const DEFAULT_OPERATIONS: readonly ApplicationMutationOperation[] = ['set']

/**
 * 一条属性的写入实现。
 *
 * 写入目标是 `draft` 而不是 store —— 这是能覆盖全部四种执行器形态的关键：
 * - 累积型（画布节点补丁、三维对象 transform 三轴要合成一个对象再一次性提交）→ draft 就是累积器
 * - 顺序依赖型（关键帧先改 time 再改 value，value 要用新 time 去找）→ 顺序状态放 draft 字段上
 * - 直写型（场景外观 24 项）→ draft 就是 store 快照本身
 * - 多 operation 型（素材集合归属 append/remove 走不同服务方法）→ 读 mutation.operation 分派
 */
export interface ApplicationPropertyWriter<TDraft> {
  /**
   * 这条属性接受哪些 operation。不写等于只接受 `set`。
   *
   * 反射层此前没有任何字段描述这件事，模型只能靠试错——素材的 library_refs 只吃 append/remove，
   * 其余属性只吃 set，发错了才在运行时报错。声明出来门禁才能校验，模型也才有据可依。
   */
  readonly operations?: readonly ApplicationMutationOperation[]
  write(draft: TDraft, mutation: ApplicationPropertyMutation): void | Promise<void>
}

/**
 * key 必须是**完整 propertyId**，不是去掉实体前缀的后缀。
 *
 * 现有代码里三种后缀切法并存，且三维那个 applyObject 一个方法服务 object 与 camera 两个 entityType，
 * 同一个后缀在两边含义不同。用完整 id 之后门禁是纯集合比较，不需要任何字符串手术。
 */
export type ApplicationPropertyWriterTable<TDraft> =
  Readonly<Record<string, ApplicationPropertyWriter<TDraft>>>

/** 执行器真正能写的属性全集。执行器的 `writableProperties` 必须由它派生，不许手写字面量。 */
export function writableProperties(
  table: ApplicationPropertyWriterTable<never>
): ReadonlySet<string> {
  return new Set(Object.keys(table))
}

/** 每条属性接受的 operation。执行器的 `propertyOperations` 必须由它派生。 */
export function propertyOperations(
  table: ApplicationPropertyWriterTable<never>
): ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>> {
  return new Map(Object.entries(table).map(([propertyId, writer]) => [
    propertyId,
    new Set(writer.operations ?? DEFAULT_OPERATIONS),
  ]))
}

/**
 * 唯一的分发点。此前散在各执行器里的 if-else 链与各自一份的 PROPERTY_NOT_WRITABLE 抛出全部收敛到这里。
 *
 * 错误信息带上 propertyId 和可写清单：模型拿到「不可写」而不知道是哪条、也不知道有哪些能写时，
 * 一个本可自纠的失败会变成任务中断。
 */
export async function applyWriterTable<TDraft>(
  table: ApplicationPropertyWriterTable<TDraft>,
  draft: TDraft,
  mutations: readonly ApplicationPropertyMutation[]
): Promise<void> {
  for (const mutation of mutations) {
    const writer = table[mutation.propertyId]
    if (!writer) {
      throw new Error(
        `PROPERTY_NOT_WRITABLE:${mutation.propertyId}`
        + ` 不可写。可写属性：${Object.keys(table).join('、')}`
      )
    }
    const allowed = writer.operations ?? DEFAULT_OPERATIONS
    if (!allowed.includes(mutation.operation)) {
      throw new Error(
        `PROPERTY_OPERATION_NOT_SUPPORTED:${mutation.propertyId}`
        + ` 只支持 ${allowed.join(' / ')} 操作，收到 ${mutation.operation}。`
      )
    }
    await writer.write(draft, mutation)
  }
}
