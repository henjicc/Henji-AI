/**
 * 组件样张页覆盖检查（任务 5.11）：`@/components/ui` 新增导出组件却没有上样张页时提醒。
 *
 * 从 `src/components/ui/index.ts` 出发，跟随 `export *` 与 `export { default as X }`，收集导出的组件
 * （首字母大写、第二个字母小写的 const / function / class，排除常量与类型），要求每个组件在
 * `src/features/devGallery/` 的样张源码里以 JSX（`<Name` 或 `<Name.Provider`）出现。
 * 确实不是可见组件的，登记到 NON_VISUAL 并写理由。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = path.resolve(__dirname, '../../components/ui')
const GALLERY_DIR = __dirname

/** 不在样张页以 JSX 出现的导出（必须写理由）。 */
const NON_VISUAL: Record<string, string> = {
  GlobalAlertDialog: '全局挂载在 App 根上、由 alertDialogStore 驱动；外观就是 AlertDialog，样张页以 AlertDialog 展示',
}

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate
  }
  return null
}

const COMPONENT_NAME = /^[A-Z][a-z]/

function collectExportedComponents(file: string, seen = new Set<string>()): Set<string> {
  const names = new Set<string>()
  if (seen.has(file)) return names
  seen.add(file)
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/^export (?:const|function|class) ([A-Za-z0-9_]+)/gm)) {
    if (COMPONENT_NAME.test(match[1])) names.add(match[1])
  }
  for (const match of source.matchAll(/^export \{([^}]*)\} from '([^']+)'/gm)) {
    if (/^\s*type\b/.test(match[1])) continue
    for (const part of match[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed || trimmed.startsWith('type ')) continue
      const exported = trimmed.split(/\s+as\s+/).pop() ?? ''
      if (COMPONENT_NAME.test(exported)) names.add(exported)
    }
  }
  for (const match of source.matchAll(/^export \* from '([^']+)'/gm)) {
    const target = resolveModule(file, match[1])
    if (target) collectExportedComponents(target, seen).forEach((name) => names.add(name))
  }
  return names
}

function gallerySource(): string {
  return readdirSync(GALLERY_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readFileSync(path.join(GALLERY_DIR, name), 'utf8'))
    .join('\n')
}

describe('组件样张页覆盖 @/components/ui 全部导出组件（任务 5.11）', () => {
  const exported = [...collectExportedComponents(path.join(UI_DIR, 'index.ts'))].sort()
  const source = gallerySource()

  it('能从 index.ts 收集到导出组件（防止解析失效后空跑通过）', () => {
    expect(exported).toEqual(expect.arrayContaining(['UiButton', 'UiModal', 'Dropdown', 'PanelTrigger', 'UiToast', 'PromptEditor']))
    expect(exported.length).toBeGreaterThan(30)
  })

  it('每个导出组件都在样张页出现，或登记为非可见并写明理由', () => {
    const missing = exported.filter((name) => !NON_VISUAL[name] && !new RegExp(`<${name}[\\s.>/]`).test(source))
    expect(missing, `这些 @/components/ui 导出组件还没上组件样张页（src/features/devGallery/gallerySections.tsx 补一个样本，或在本测试 NON_VISUAL 写理由）：${missing.join('、')}`).toEqual([])
  })

  it('非可见登记没有过期', () => {
    const stale = Object.keys(NON_VISUAL).filter((name) => !exported.includes(name))
    expect(stale).toEqual([])
    for (const reason of Object.values(NON_VISUAL)) expect(reason.length).toBeGreaterThanOrEqual(8)
  })
})
