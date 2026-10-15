import type { PersistenceMigrations } from './migrations'
import { migrateThemePayloadV1 } from '../theme/themeMigration'
import { migrateMcpConnectionStorageV1 } from './mcpConnectionSchema'
import { migrateSettingsV13 } from './settingsSchema'
import { migrateModelDefaultsV1 } from './preferenceSchemas'

/** Add N → N+1 here for non-document formats. Document kinds own their own chain. */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  settings: { 13: migrateSettingsV13 },
  'model-defaults': { 1: migrateModelDefaultsV1 },
  // 1 → 2：增加敏感区域事件分支，已有事件、时钟与序号不变。
  'capture-log-page': { 1: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 2 } : content },
  // 1 → 2：仅增加可选 screen_attention 来源，旧候选的曲线与身份语义保持不变。
  'creative-intent-candidate': { 1: content => content && typeof content === 'object' && !Array.isArray(content)
    ? { ...content, version: 2 } : content },
  // Reuse the existing theme migration; t94 does not invent migrations for old development projects.
  'theme-payload': { 1: content => migrateThemePayloadV1(content) },
  // 3 → 4：保存的声音片段的效果新增可选缩放区间 regions，已有片段原样保留，只更新版本号。
  'subtitle-manifest': {
    // 1 → 2：字幕增加可选 sourceText，不伪造旧文件未记录的原文。
    1: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 2 } : content,
    // 2 → 3：曲线增加可选 screen_attention 来源，旧曲线身份及手改归属不变。
    2: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 3 } : content,
    3: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 4 } : content,
    // 4 → 5（t97）：片段不再有风格覆盖，去掉回填声音片段上的 styleKitId。
    4: content => {
      if (!content || typeof content !== 'object' || Array.isArray(content)) return content
      const record = content as Record<string, unknown>
      const soundClips = Array.isArray(record.soundClips) ? record.soundClips.map(clip => { if (!clip || typeof clip !== 'object' || Array.isArray(clip)) return clip; const { styleKitId: _id, ...rest } = clip as Record<string, unknown>; return rest }) : record.soundClips
      return { ...record, version: 5, ...(soundClips ? { soundClips } : {}) }
    },
    // 5 → 6（t102）：声音片段的代码参数类型拓宽，仅更新清单版本。
    5: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 6 } : content,
  },
  // 1 → 2（t97）：风格改为说明书，旧包里的参数式风格项丢弃，其余预设原样保留。
  'video-preset-package': {
    1: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 2, items: Array.isArray((content as { items?: unknown }).items) ? ((content as { items: Array<{ category?: unknown }> }).items).filter(item => item?.category !== 'style') : [] } : content,
    // 2 → 3（t102）：标题模板的代码参数类型拓宽，预设原样保留。
    2: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 3 } : content,
  },
  // 1 → 2（t102）：媒体依赖增加视频/音频，参数增加音频与下方画面引用，旧资产原样保留。
  'code-asset': { 1: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 2 } : content },
  // 3 → 4（t102）：代码参数类型拓宽；库内容不携带版本，版本由 versionedJson 外壳更新。
  'title-templates': {
    // 1 → 2：字幕原文字段只影响共享片段 schema；模板内容不变。
    1: content => content,
    // 2 → 3：增加可选 screen_attention 曲线来源，模板内旧曲线不变。
    2: content => content,
    3: content => content,
  },
  // 1 → 2：外部连接改为永久有效，去掉到期时间与提醒记录。
  'mcp-connections': { 1: migrateMcpConnectionStorageV1 },
  // 1 → 2（t97）：旧 Markdown 规则移入 notes，新增理念、节奏、结构化规则、生成注入与扩展动效由默认值补齐。
  // t97：风格改为给 AI 的说明书，旧版个人风格不再适用，按开发期约定清空。
  'style-kits': { 1: () => [], 2: () => [] },
}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
