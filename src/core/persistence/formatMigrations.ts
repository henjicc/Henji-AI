import type { PersistenceMigrations } from './migrations'
import { migrateThemePayloadV1 } from '../theme/themeMigration'
import { migrateMcpConnectionStorageV1 } from './mcpConnectionSchema'
import { migrateStyleKitV1 } from '../videoEdit/styleKit'

/** Add N → N+1 here for non-document formats. Document kinds own their own chain. */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // 1 → 2：仅增加可选 screen_attention 来源，旧候选的曲线与身份语义保持不变。
  'creative-intent-candidate': { 1: content => content && typeof content === 'object' && !Array.isArray(content)
    ? { ...content, version: 2 } : content },
  // Reuse the existing theme migration; t94 does not invent migrations for old development projects.
  'theme-payload': { 1: content => migrateThemePayloadV1(content) },
  // 录屏注意力共享曲线契约：subtitle-manifest/title-templates v3 已登记 dev-break，不保留旧开发格式迁移。
  // 3 → 4：保存的声音片段的效果新增可选缩放区间 regions，已有片段原样保留，只更新版本号。
  'subtitle-manifest': { 3: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 4 } : content },
  // 1 → 2：外部连接改为永久有效，去掉到期时间与提醒记录。
  'mcp-connections': { 1: migrateMcpConnectionStorageV1 },
  // 1 → 2（t97）：旧 Markdown 规则移入 notes，新增理念、节奏、结构化规则、生成注入与扩展动效由默认值补齐。
  'style-kits': { 1: content => Array.isArray(content) ? content.map(migrateStyleKitV1) : content },
}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
