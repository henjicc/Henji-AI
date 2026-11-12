import { z } from 'zod'

/**
 * 不可变文档的增量校验：结果与 `schema.parse` 相同，但与 `base` 同一引用、且由本解析器校验过的子树直接沿用。
 *
 * 大文档一次编辑通常只换掉几个节点（剪辑正片约 1.5MB，一小时口播上万词块），其余节点仍是上次校验结果里的同一个对象。
 * schema 对每个节点是纯函数，所以同一引用的子树不必重算；换掉的节点按它所在位置的 schema 解析，对象按 schema 字段顺序重新拼装
 * （文件键序不变），拼好的对象与数组再跑它们自己的检查（refine、superRefine、长度），根节点的检查每次都跑。
 * 增量路径任何一步不通过（包括检查函数抛错）就整份重新校验，所以报错与整份校验一字不差。
 *
 * 只有本解析器成功校验并冻结的节点才会被沿用；外部冻结的草稿仍需校验。结果一律深度冻结：之后改到共享子树会当场抛 TypeError，
 * 而不是悄悄改坏撤销历史里共用这个节点的其他文档。每个解析器各自登记可信节点，不同 schema 之间不互认。
 */
export interface IncrementalSchemaParser<T> {
  parse(value: unknown, base?: T, onUnexpectedFallback?: (error: unknown) => void): T
  /** 冻结只保护共享引用，不授予校验信任；外部的浅冻结对象仍需遍历子树。 */
  freeze<V>(value: V): V
}

/** T 由调用方声明：领域类型与 schema 推导出的类型不总是字面一致，校验本身仍以 schema 为准。 */
export function createIncrementalSchemaParser<T>(schema: z.core.$ZodType): IncrementalSchemaParser<T> {
  const validatedNodes = new WeakSet<object>()
  const deeplyFrozenNodes = new WeakSet<object>()

  function freezeTree(value: unknown, validated = false): void {
    if (typeof value !== 'object' || value === null || (validated ? validatedNodes : deeplyFrozenNodes).has(value)) return
    for (const child of Object.values(value)) freezeTree(child, validated)
    Object.freeze(value)
    deeplyFrozenNodes.add(value)
    if (validated) validatedNodes.add(value)
  }

  function reusable(value: unknown): boolean {
    return typeof value !== 'object' || value === null || validatedNodes.has(value)
  }

  /**
   * `base` 是同一 schema 位置上校验过的值（没有时为 undefined）；只有同一引用才沿用，匹配只决定往下找可沿用子树的范围。
   * 标量只在所属原节点已校验时才沿用：草稿节点即使冻结也可能未规范化，只沿用其中已校验的子对象。
   */
  function parseNode(node: z.core.$ZodType, value: unknown, base: unknown): unknown {
    // undefined 也代表找不到可信基线，必须让 schema 判断缺失值是否合法及是否需要默认值。
    if (value !== undefined && value === base && reusable(value)) return value
    if (node instanceof z.core.$ZodOptional && value !== undefined) return runChecks(node, parseNode(node._zod.def.innerType, value, base))
    if (node instanceof z.core.$ZodObject && isRecord(value) && isRecord(base)) {
      const catchall = node._zod.def.catchall
      // 允许未知字段的对象要按 catchall 逐个解析并保持原键序，直接整个解析
      if (!catchall || catchall instanceof z.core.$ZodNever) return runChecks(node, parseObject(node._zod.def.shape, value, base, Boolean(catchall)))
    }
    if (node instanceof z.core.$ZodArray && Array.isArray(value) && Array.isArray(base)) return runChecks(node, parseArray(node._zod.def.element, value, base))
    const result = z.safeParse(node, value)
    if (!result.success) throw new Mismatch()
    return result.data
  }

  function trustedChild(child: unknown, parentValidated: boolean): unknown {
    // 未校验的对象仍可提供子树匹配位置；是否沿用由节点的校验登记决定，标量则必须来自可信父节点。
    return parentValidated || (typeof child === 'object' && child !== null) ? child : undefined
  }

  /** 与 zod 对象解析相同：按 schema 字段顺序输出；输入里出现过的字段即使值为 undefined 也保留这个键。 */
  function parseObject(shape: z.core.$ZodShape, value: Record<string, unknown>, base: Record<string, unknown>, strict: boolean): Record<string, unknown> {
    if (strict) for (const key in value) if (!Object.hasOwn(shape, key)) throw new Mismatch()
    const validated = validatedNodes.has(base)
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(shape)) {
      const field = shape[key]
      const present = key in value
      if (!present && field._zod.optin !== 'optional') throw new Mismatch()
      const result = parseNode(field, value[key], trustedChild(base[key], validated))
      if (result !== undefined || present) output[key] = result
    }
    return output
  }

  /** 元素换了位置也照样沿用；改过的元素按 id（没有 id 时按下标）找到原来那个元素，在它里面继续找可沿用的子树。 */
  function parseArray(element: z.core.$ZodType, value: readonly unknown[], base: readonly unknown[]): unknown[] {
    const validated = validatedNodes.has(base)
    const known = new Set(validated ? base : base.filter(entry => typeof entry === 'object' && entry !== null && validatedNodes.has(entry)))
    let byId: Map<unknown, unknown> | undefined
    const output = new Array<unknown>(value.length)
    for (let index = 0; index < value.length; index++) {
      const item = value[index]
      if (known.has(item) && reusable(item)) { output[index] = item; continue }
      byId ??= new Map(base.flatMap(entry => isRecord(entry) && entry.id !== undefined ? [[entry.id, entry] as const] : []))
      const id = isRecord(item) ? item.id : undefined
      output[index] = parseNode(element, item, trustedChild((id !== undefined ? byId.get(id) : undefined) ?? base[index], validated))
    }
    return output
  }

  return {
    parse(value, base, onUnexpectedFallback) {
      if (base) {
        try {
          const result = parseNode(schema, value, base) as T
          freezeTree(result, true)
          return result
        }
        catch (error) { if (!(error instanceof Mismatch)) onUnexpectedFallback?.(error) }
      }
      const result = z.parse(schema, value) as T
      freezeTree(result, true)
      return result
    },
    freeze(value) {
      freezeTree(value)
      return value
    },
  }
}

/** 增量路径不成立，改走整份校验。 */
class Mismatch extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 在拼好的值上跑这个 schema 自己的检查，规则同 zod：带 when 的检查只在 when 成立时运行；检查可以改写值（overwrite）。 */
function runChecks(schema: z.core.$ZodType, value: unknown): unknown {
  const checks = schema._zod.def.checks
  if (!checks?.length) return value
  const payload: z.core.ParsePayload = { value, issues: [] }
  for (const check of checks) {
    const when = check._zod.def.when
    if (when && !when(payload)) continue
    if (check._zod.check(payload as z.core.ParsePayload<never>) instanceof Promise || payload.issues.length) throw new Mismatch()
  }
  return payload.value
}
