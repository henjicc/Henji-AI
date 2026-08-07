import { z } from 'zod'

import {
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

/*
 * 三维各实体统一字段定义共用的一小撮基础设施：描述符工厂、值编解码、通用字段构造器。
 * 被 cameraStageSceneFields.ts / cameraStageObjectFields.ts / cameraStageTimelineFields.ts
 * 三个 Fields 文件共用，避免每个文件各自重复一份 digest/codec/descriptor 样板（1.2 试点时
 * 这套样板还是场景字段文件的私有实现，1.3 把它提出来给其余领域复用）。
 */

const REVISION_SCOPE = 'toolbox' as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

export function stageDescriptor(
  entityType: string,
  suffix: string,
  title: string,
  value: ApplicationPropertyValue,
  options: {
    unit?: string
    nullable?: boolean
    relation?: ApplicationPropertyDescriptor['relation']
    description?: string
  } = {},
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: options.description ?? `三维${title}的稳定控制属性。`,
    value,
    ...(options.unit ? { unit: options.unit } : {}),
    nullable: options.nullable ?? false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['camera_stage:read'], write: ['camera_stage:write'] },
    revisionScopes: [REVISION_SCOPE],
    schemaRef: {
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      kind: 'property',
      id,
      version: 1,
      digest: digest(`property:${id}`),
    },
    ...(options.relation ? { relation: options.relation } : {}),
  }
}

/** 一条属性的值编解码：怎么从 JSON 解析出领域值、怎么把领域值编回 JSON。 */
export interface ValueCodec<T> {
  readonly value: ApplicationPropertyValue
  parse(raw: JsonValue | undefined): T
  encode(value: T): JsonValue
}

export const stringCodec: ValueCodec<string> = {
  value: { kind: 'string', maxLength: 500 },
  parse: (raw) => z.string().parse(raw),
  encode: (value) => value,
}
/** 各实体的 `name` 字段专用：最短 1 位、最长受调用方传入的上限约束（通常是 `CAMERA_STAGE_NAME_MAX_LENGTH`）。 */
export function nameCodec(maxLength: number): ValueCodec<string> {
  return { value: { kind: 'string', minLength: 1, maxLength }, parse: (raw) => z.string().parse(raw), encode: (value) => value }
}
/**
 * 可空枚举：读侧可能是 `null`（对象类型不匹配时），写侧永远拒绝 `null`——与原始实现
 * （`z.enum([...]).parse(m.value)`）行为一致，`null` 传进来时 `parse` 直接抛错。
 */
export function nullableEnumCodec<T extends string>(values: readonly T[], labels: Record<T, string>): ValueCodec<T | null> {
  return {
    value: { kind: 'enum', values: values.map((value) => ({ value, label: labels[value] })) },
    parse: (raw) => z.enum(values as [T, ...T[]]).parse(raw),
    encode: (value) => value,
  }
}
export const colorCodec: ValueCodec<string> = {
  value: { kind: 'color', format: 'hex' },
  parse: (raw) => z.string().parse(raw),
  encode: (value) => value,
}
export const booleanCodec: ValueCodec<boolean> = {
  value: { kind: 'boolean' },
  parse: (raw) => z.boolean().parse(raw),
  encode: (value) => value,
}
/*
 * `hardRange`/`softRange` 必须按需展开、不能作为显式 `undefined` 键塞进 value 对象——
 * `jsonValueSchema` 校验时会把 `{ softRange: undefined }` 当成"有这个 key 但值不是合法
 * JSON"而报错（JSON 没有 undefined），跟"没有这个 key"不是一回事。这个坑在共享出来加
 * softRange 支持时踩过一次：调用方不传 softRange 时门禁全体变红。
 */
export function numberCodec(hardRange?: { min?: number; max?: number }, softRange?: { min?: number; max?: number }): ValueCodec<number> {
  return {
    value: { kind: 'number', ...(hardRange ? { hardRange } : {}), ...(softRange ? { softRange } : {}) },
    parse: (raw) => z.number().parse(raw),
    encode: (value) => value,
  }
}
export function integerCodec(hardRange?: { min?: number; max?: number }): ValueCodec<number> {
  return { value: { kind: 'integer', ...(hardRange ? { hardRange } : {}) }, parse: (raw) => z.number().parse(raw), encode: (value) => value }
}
export function enumCodec<T extends string>(values: readonly T[], labels: Record<T, string>): ValueCodec<T> {
  return {
    value: { kind: 'enum', values: values.map((value) => ({ value, label: labels[value] })) },
    parse: (raw) => z.enum(values as [T, ...T[]]).parse(raw),
    encode: (value) => value,
  }
}
export function vector3Codec(unit?: string): ValueCodec<{ x: number; y: number; z: number }> {
  return {
    value: unit ? { kind: 'vector3', unit } : { kind: 'vector3' },
    parse: (raw) => z.object({ x: z.number(), y: z.number(), z: z.number() }).strict().parse(raw),
    encode: (value) => ({ x: value.x, y: value.y, z: value.z }),
  }
}
/** 引用型属性（可空）：解析成裸 id（供 store 方法直接使用），不负责编回 ref 对象——那需要额外上下文（如 projectId），由调用方自行处理读取侧。 */
export function refIdCodec(refKinds: readonly string[]): ValueCodec<string | null> {
  return {
    value: { kind: 'ref', refKinds: [...refKinds] },
    parse: (raw) => {
      if (raw === null || raw === undefined) return null
      return z.object({ kind: z.string(), id: z.string() }).passthrough().parse(raw).id.split(':').pop() ?? null
    },
    encode: (value) => value,
  }
}

/**
 * 通用字段构造器：给定实体类型、后缀、标题、编解码器、读写回调，产出一条 `ApplicationFieldDefinition`。
 *
 * `storeActions` 接受**零到多个**动作名——大多数字段对应一个 store 方法，但三维 object 的
 * `name`/`visible`/`color`/`character_variant` 同时被 `updateObject` 与
 * `updateObjectAcrossShots` 两个 store 动作共用，camera 的部分字段（`fov`、
 * `look_at_object_ref` 等）目前没有任何界面动作直接绑定（0 个）。
 *
 * `TAction` 特意不标注、靠 TS 从 `storeActions` 的字符串字面量元组参数推导——调用处必须用
 * `as const` 传入（如 `['updateObject', 'updateObjectAcrossShots'] as const`），账本侧
 * `fieldLedgerEntries()` 才能拿到字面量 key 联合，保住 `Record<ActionName, …>` 的
 * 编译期完整性检查（漏一条 tsc 报错）。调用处一旦漏了 `as const` 或显式标注成 `string[]`
 * 就会破坏这一点；各领域的薄封装（`appearanceField` / `objectField` / …）因此也必须让
 * `TSource` 通过参数类型标注推导，而不是给数组整体标注宽泛类型。
 */
export function stageField<TSource, TDraft, T, TAction extends string>(
  entityType: string,
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (source: TSource) => T
    write: (draft: TDraft, value: T) => void
    storeActions: readonly TAction[]
    unit?: string
    nullable?: boolean
    description?: string
  },
): ApplicationFieldDefinition<TSource, TDraft, TAction> {
  return {
    propertyId: `${entityType}.${suffix}`,
    descriptor: stageDescriptor(entityType, suffix, title, codec.value, {
      unit: options.unit, nullable: options.nullable, description: options.description,
    }),
    read: (source) => codec.encode(options.read(source)),
    writer: { write: (draft, mutation) => { options.write(draft, codec.parse(mutation.value)) } },
    storeActions: options.storeActions,
  }
}
