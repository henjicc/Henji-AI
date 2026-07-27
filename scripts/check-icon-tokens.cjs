#!/usr/bin/env node
/**
 * 图标令牌检查。
 *
 * 背景：图标此前没有单点落地，业务组件一半用 lucide、一半手写 inline <svg>，
 * 结果同一个「资产库」概念在顶部导航、工具栏、侧栏长成三个样，
 * 「工具箱」和「设置」还共用了同一个齿轮。
 *
 * 两条规则：
 *   A. 业务组件禁止手写 <svg>——图标一律走 lucide-react（与「原生 <button> 只能落在
 *      primitives.tsx」同构）。真正的图形（波形、缓动曲线、连线预览）在豁免名单里。
 *   B. 跨界面复用的业务概念图标必须走 `src/core/theme/icons.ts` 的登记常量，
 *      不要在调用点各自从 lucide 挑图形。
 *
 * 用法：
 *   node scripts/check-icon-tokens.cjs            # 告警式，退出码恒为 0
 *   node scripts/check-icon-tokens.cjs --strict   # 门禁式，有命中即非 0
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const REGISTRY = path.join(SRC, 'core', 'theme', 'icons.ts')

/**
 * 真正的图形，不是图标：这些 <svg> 承载的是数据可视化或画布绘制，
 * 换成图标库反而是错的。新增豁免必须在这里写明理由。
 */
const GRAPHIC_EXEMPTIONS = new Map([
  ['src/components/Waveform.tsx', '音频波形，逐条 rect 由采样数据绘制'],
  ['src/features/cameraStage/timeline/EasingCurveEditor.tsx', '缓动曲线编辑器，路径由控制点算出'],
  ['src/features/cameraStage/timeline/GraphEditor.tsx', '关键帧曲线图，路径由数据算出'],
  ['src/features/canvas/ui/CanvasOverlays.tsx', '画布连线预览，路径随指针位置实时计算'],
])

/**
 * 只登记在本仓库里**语义唯一**的图形。
 *
 * 刻意不登记 LayoutGrid / Wrench / MessageCircle 这类通用形状：它们在本仓库同时表示
 * 多个含义（LayoutGrid 既是画布 tab、又是分组节点、还是设置里的「界面」分区；
 * Wrench 既是工具箱、又是助手的工具调用）。把它们锁死只会逼出一堆错误重命名。
 * 「同一形状表示多个概念」是另一类问题，要靠换形状解决，不归这条检查管。
 */
const CONCEPT_ICONS = new Map([
  ['Library', 'ICON_ASSET_LIBRARY'],
  ['LibraryBig', 'ICON_ASSET_LIBRARY'],
  ['Clapperboard', 'ICON_TOOL_CAMERA_STAGE'],
])

const ALLOW_COMMENT = 'icon-token-allow'

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function toRel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

function lineAllowed(lines, index) {
  const current = lines[index] || ''
  const previous = lines[index - 1] || ''
  return current.includes(ALLOW_COMMENT) || previous.includes(ALLOW_COMMENT)
}

function main() {
  const strict = process.argv.includes('--strict')
  const findings = []

  for (const file of walk(SRC)) {
    const rel = toRel(file)
    if (rel === 'src/core/theme/icons.ts') continue
    const source = fs.readFileSync(file, 'utf8')
    const lines = source.split(/\r?\n/)

    // 规则 A：手写 <svg>
    if (!GRAPHIC_EXEMPTIONS.has(rel)) {
      lines.forEach((line, index) => {
        if (!line.includes('<svg')) return
        if (lineAllowed(lines, index)) return
        findings.push({
          rule: 'A',
          rel,
          line: index + 1,
          message: '手写 inline <svg>：图标请改用 lucide-react；确属图形请加入豁免名单并写明理由',
        })
      })
    }

    // 规则 B：概念图标绕过登记表
    const importMatch = source.match(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/)
    if (importMatch) {
      const imported = importMatch[1]
        .split(',')
        .map((name) => name.replace(/\btype\b/, '').trim())
        .filter(Boolean)
      const importLine = source.slice(0, importMatch.index).split(/\r?\n/).length
      for (const name of imported) {
        const token = CONCEPT_ICONS.get(name)
        if (!token) continue
        if (lineAllowed(lines, importLine - 1)) continue
        findings.push({
          rule: 'B',
          rel,
          line: importLine,
          message: `概念图标 ${name} 应改用登记常量 ${token}（@/core/theme/icons）`,
        })
      }
    }
  }

  if (findings.length === 0) {
    console.log('[check-icon-tokens] 通过：未检测到手写 svg 或绕过登记表的概念图标。')
    return
  }

  for (const item of findings) {
    console.log(`[${item.rule}] ${item.rel}:${item.line} ${item.message}`)
  }
  console.log(`\n[check-icon-tokens] 命中 ${findings.length} 处。`)
  console.log(`豁免写法：在该行或上一行加注释 ${ALLOW_COMMENT} 并说明理由。`)
  if (strict) process.exitCode = 1
}

if (!fs.existsSync(REGISTRY)) {
  console.error('[check-icon-tokens] 缺少图标登记表 src/core/theme/icons.ts')
  process.exitCode = 1
} else {
  main()
}
