/*
 * 统一字段定义：一条声明同时派生出属性描述、读取映射、写入表项、账本条目。
 *
 * 存在的理由是一个已经发生的事故：一个界面属性要在 4 个位置分别登记（属性描述、
 * 读取映射、写入表项、账本条目），缺任何一处都是静默失效——没有报错，助手安静地
 * 少一块能力，只有用户实机撞上才发现。三维场景外观 24 项当初就是这样漏掉的。
 *
 * 这里不做代码生成、不做运行时反射魔法（原因见 docs/task 的重要记录 006）：
 * 就是一个返回四元组的普通函数，四个消费方各取所需，保持可读、可跳转、可断点。
 */
import type { ApplicationPropertyDescriptor } from './reflection'
import type { ApplicationStoreActionBinding } from './storeActionLedger'
import type { ApplicationPropertyWriter, ApplicationPropertyWriterTable } from './execution/writerTable'
import type { JsonValue } from './identifiers'

/**
 * 一条字段的完整声明。`writer` 缺省表示只读——只读属性不需要在别处再写一次
 * 理由，由字段定义统一持有（`descriptor.readOnlyReason` 里已经有）。
 *
 * `storeActions` 放在字段定义里，是「让四处写在一起」的最后一块：store 动作名
 * 与属性 id 是两条不同的轴，无法自动对上，但可以要求写在同一处声明里。
 */
export interface ApplicationFieldDefinition<TSource, TDraft> {
  readonly propertyId: string
  readonly descriptor: ApplicationPropertyDescriptor
  readonly read: (source: TSource) => JsonValue
  readonly writer?: ApplicationPropertyWriter<TDraft>
  readonly storeActions: readonly string[]
}

/** 供属性反射层使用：这一批字段的描述符列表。 */
export function fieldDescriptors<TSource, TDraft>(
  fields: readonly ApplicationFieldDefinition<TSource, TDraft>[],
): ApplicationPropertyDescriptor[] {
  return fields.map((field) => field.descriptor)
}

/** 供反射层的 `properties()` 读取路径使用：从同一个 source 快照批量取值。 */
export function fieldReadValues<TSource, TDraft>(
  fields: readonly ApplicationFieldDefinition<TSource, TDraft>[],
  source: TSource,
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {}
  for (const field of fields) {
    result[field.propertyId] = field.read(source)
  }
  return result
}

/**
 * 供 mutation 执行器使用：只收编声明了 `writer` 的字段，直接就是
 * `ApplicationPropertyWriterTable`，可以被 `applyWriterTable()` 直接消费。
 */
export function fieldWriterTable<TSource, TDraft>(
  fields: readonly ApplicationFieldDefinition<TSource, TDraft>[],
): ApplicationPropertyWriterTable<TDraft> {
  const table: Record<string, ApplicationPropertyWriter<TDraft>> = {}
  for (const field of fields) {
    if (field.writer) table[field.propertyId] = field.writer
  }
  return table
}

/**
 * 供界面动作账本使用：把每个字段挂到的 store 动作名映射成 `property` 绑定。
 * `storeActions` 为空的字段（没有对应的界面动作，例如纯派生只读值）不产生账本条目。
 */
export function fieldLedgerEntries<TSource, TDraft>(
  fields: readonly ApplicationFieldDefinition<TSource, TDraft>[],
): Record<string, ApplicationStoreActionBinding> {
  const entries: Record<string, ApplicationStoreActionBinding> = {}
  for (const field of fields) {
    for (const action of field.storeActions) {
      entries[action] = { kind: 'property', propertyIds: [field.propertyId] }
    }
  }
  return entries
}
