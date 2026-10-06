/**
 * 可自定义按钮栏的共用规则（剪辑对齐 PR 2.4／2.5）：监视器底部与轨道头的按钮栏都只存用户改过的那一栏，
 * 没存 = 默认（默认随版本调整时跟着走）。读设置时清洗掉不认识的按钮与重复项，写设置时与默认相同就不存。
 */
export function sanitizeVideoEditButtonBar<Id extends string>(catalog: readonly Id[], value: unknown): Id[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((id): id is Id => typeof id === 'string' && (catalog as readonly string[]).includes(id)))]
}

/** 按 `kinds` 逐栏清洗整份布局；形状不对的那一栏回到默认，不让旧设置读失败。 */
export function sanitizeVideoEditButtonBars<Kind extends string, Id extends string>(kinds: readonly Kind[], catalog: (kind: Kind) => readonly Id[], value: unknown): Partial<Record<Kind, Id[]>> {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const result: Partial<Record<Kind, Id[]>> = {}
  for (const kind of kinds) {
    const list = sanitizeVideoEditButtonBar(catalog(kind), record[kind])
    if (list) result[kind] = list
  }
  return result
}

/** 写一栏：`null` 或与默认相同即删除这一栏（回到默认）。 */
export function withVideoEditButtonBar<Kind extends string, Id extends string>(layouts: Partial<Record<Kind, readonly Id[]>>, kind: Kind, ids: readonly string[] | null, catalog: readonly Id[], defaults: readonly Id[]): Partial<Record<Kind, readonly Id[]>> {
  const rest = { ...layouts }; delete rest[kind]
  const list = ids === null ? undefined : sanitizeVideoEditButtonBar(catalog, ids)
  if (!list || (list.length === defaults.length && list.every((id, index) => id === defaults[index]))) return rest
  return { ...rest, [kind]: list }
}
