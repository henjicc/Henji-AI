/**
 * 旧界面代码残留扫描（报告模式，任务 5.2；5.8 再把需要的类别接进门禁）。
 *
 * 按 skill henji-ui-surface references/review.md 第 3 节“代码残留”逐类统计，按文件与 5.1 盘点的区域、界面编号出报告：
 *   npm run ui:residue                         # 写 .ui-tour/residue/residue-report.{md,json}
 *   npm run ui:residue -- --out .ui-tour/residue-after-4.2
 *   npm run ui:residue -- --region 5.3         # 只看一个区域
 *   npm run ui:residue -- --files src/a.tsx,src/b.tsx
 *
 * 退出码恒为 0（读文件失败除外）：它是盘点工具，不是门禁。
 */
const fs = require('node:fs')
const path = require('node:path')
const {
  RESIDUE_CATEGORIES,
  classReferencePattern,
  extractCssClassNames,
  extractImportSpecifiers,
  parseRegionInventory,
  resolveImport,
  resolveRegion,
  scanCssText,
  scanLocaleJson,
  scanSourceText,
} = require('./lib/uiResidueRules.cjs')

const ROOT = path.resolve(__dirname, '..')
const INVENTORY_FILE = 'docs/task/界面重设计与主题引擎/任务/第五阶段-全界面核对与旧界面清零/5.1-全界面清单与残留盘点.md'
const COLOR_ALLOWLIST_FILE = 'scripts/check-color-tokens.allowlist.json'
/** 从这些目录导入 src 的文件也算“被引用”（主进程与 preload 会引用 src/core 等共享模块）。 */
const IMPORTER_ROOTS = ['src', 'electron']
/** 只经 HTML 或构建配置进入的入口，不按 import 判死代码。 */
const ENTRY_PATTERNS = [/^src\/main\.tsx$/, /^src\/[\w-]+\/main\.tsx$/, /\.d\.ts$/, /^src\/vite-env/, /\.worker\.ts$/]

function printHelp() {
  console.log(`旧界面代码残留扫描（报告模式）

用法：
  npm run ui:residue [-- --out <目录>] [--region 5.3] [--files a,b] [--top 15]

  --out <目录>     报告目录，默认 .ui-tour/residue（不进仓库）
  --region <编号>  只输出某个区域（5.3 生成 / 5.4 画布 / 5.5 工具与剪辑 / 5.6 资产设置与助手 / 5.7 通用）
  --files <列表>   只扫描这些文件（逗号分隔，仓库相对路径），死代码与零引用类不统计
  --top <数量>     每个类别列出的文件数，默认 15
`)
}

function parseArgs(argv) {
  const options = { outDir: '.ui-tour/residue', region: null, files: [], top: 15, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${token} 缺少参数值`)
      index += 1
      return next
    }
    if (token === '--help' || token === '-h') options.help = true
    else if (token === '--out') options.outDir = value()
    else if (token === '--region') options.region = value()
    else if (token === '--files') options.files.push(...value().split(',').map((item) => item.trim()).filter(Boolean))
    else if (token === '--top') options.top = Number(value())
    else throw new Error(`未知参数：${token}`)
  }
  if (!Number.isInteger(options.top) || options.top < 1) throw new Error('--top 必须是正整数')
  return options
}

function toRelative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function walk(dir, predicate, result = []) {
  if (!fs.existsSync(dir)) return result
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, predicate, result)
    else if (predicate(entry.name, full)) result.push(full)
  }
  return result
}

const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /[\\/](tests?|__tests__|__mocks__)[\\/]/.test(name)
const isSource = (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')
const isUiSource = (file) => file.endsWith('.tsx') || /^src\/(components|workspaces|contexts)\//.test(file)

function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function collectFindings(options) {
  const allSources = walk(path.join(ROOT, 'src'), (name, full) => isSource(name) && !isTestFile(full)).map(toRelative)
  const cssFiles = walk(path.join(ROOT, 'src'), (name) => name.endsWith('.css')).map(toRelative)
  const localeFiles = walk(path.join(ROOT, 'src/i18n/locales'), (name) => name.endsWith('.json')).map(toRelative)
  const scoped = options.files.length > 0
  const inScope = (file) => !scoped || options.files.includes(file)
  /** @type {Map<string, {category: string, line: number, text: string}[]>} */
  const byFile = new Map()
  const add = (file, findings) => {
    if (!findings.length) return
    byFile.set(file, [...(byFile.get(file) ?? []), ...findings])
  }

  for (const file of allSources.filter(inScope)) add(file, scanSourceText(readText(file)))
  for (const file of cssFiles.filter(inScope)) add(file, scanCssText(readText(file), file))
  for (const file of localeFiles.filter(inScope)) add(file, scanLocaleJson(readText(file)))

  // check:colors 登记文件：按文件计入（legacy 已在上面按实际文本数过，这里只记其余登记规则）
  const allowlist = JSON.parse(readText(COLOR_ALLOWLIST_FILE))
  for (const [file, entry] of Object.entries(allowlist.files ?? {})) {
    if (!inScope(file)) continue
    for (const [rule, count] of Object.entries(entry.counts ?? {})) {
      if (rule === 'legacy' || !count) continue
      add(file, Array.from({ length: count }, () => ({ category: 'colorAllowlist', line: 0, text: `${rule}（登记）` })))
    }
  }

  // 私有 CSS 类：定义在 css 里的类，在哪些源文件里用到；零引用的作为候选
  const sourceTexts = new Map(allSources.map((file) => [file, readText(file)]))
  for (const cssFile of cssFiles) {
    for (const name of extractCssClassNames(readText(cssFile))) {
      const pattern = classReferencePattern(name)
      const users = [...sourceTexts].filter(([, text]) => pattern.test(text)).map(([file]) => file)
      for (const user of users.filter(inScope)) {
        add(user, [{ category: 'privateCssClass', line: 0, text: `.${name}（${cssFile}）` }])
      }
      if (!scoped && users.length === 0) add(cssFile, [{ category: 'unusedCssClass', line: 0, text: `.${name}` }])
    }
  }

  if (!scoped) {
    // 死代码候选：非测试代码里没有任何 import 指向的源文件；只被测试引用的单列
    const importerFiles = IMPORTER_ROOTS.flatMap((dir) => walk(path.join(ROOT, dir), (name) => /\.(ts|tsx|cjs|mjs|js)$/.test(name)))
      .map(toRelative)
    const known = new Set([...allSources, ...cssFiles])
    const referencedByCode = new Set()
    const referencedByTests = new Set()
    for (const importer of importerFiles) {
      const target = isTestFile(importer) ? referencedByTests : referencedByCode
      for (const specifier of extractImportSpecifiers(readText(importer))) {
        const resolved = resolveImport(specifier, importer, known)
        if (resolved && resolved !== importer) target.add(resolved)
      }
    }
    for (const html of walk(ROOT, (name, full) => name.endsWith('.html') && !full.includes(`${path.sep}out${path.sep}`)
      && !full.includes(`${path.sep}release${path.sep}`) && !full.includes(`${path.sep}docs${path.sep}`))) {
      for (const match of fs.readFileSync(html, 'utf8').matchAll(/src="\/?([^"]+\.tsx?)"/g)) referencedByCode.add(match[1])
    }
    // 只统计界面代码（组件与界面目录里的 .tsx、组件/工作区目录的 .ts）；core 与应用服务的死代码不属于本扫描
    for (const file of allSources.filter(isUiSource)) {
      if (referencedByCode.has(file) || ENTRY_PATTERNS.some((pattern) => pattern.test(file))) continue
      add(file, [{ category: referencedByTests.has(file) ? 'testOnlyCode' : 'deadCode', line: 0, text: file }])
    }
  }
  return byFile
}

function summarize(byFile, inventory, options) {
  const files = [...byFile].map(([file, findings]) => {
    const counts = Object.fromEntries(RESIDUE_CATEGORIES.map((category) => [category.key, 0]))
    for (const finding of findings) counts[finding.category] += 1
    return { file, ...resolveRegion(file, inventory), counts, findings }
  }).filter((entry) => !options.region || entry.region === options.region)
    .sort((a, b) => a.file.localeCompare(b.file))
  const totals = Object.fromEntries(RESIDUE_CATEGORIES.map(({ key }) => [key, {
    count: files.reduce((total, entry) => total + entry.counts[key], 0),
    files: files.filter((entry) => entry.counts[key] > 0).length,
  }]))
  const regions = new Map()
  for (const entry of files) {
    const key = `${entry.region} ${entry.regionLabel}`
    const row = regions.get(key) ?? Object.fromEntries(RESIDUE_CATEGORIES.map(({ key: category }) => [category, 0]))
    for (const { key: category } of RESIDUE_CATEGORIES) row[category] += entry.counts[category]
    regions.set(key, row)
  }
  return { files, totals, regions: Object.fromEntries([...regions].sort(([a], [b]) => a.localeCompare(b))) }
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/\s+/g, ' ')
}

function renderMarkdown(summary, options, inventoryCount) {
  const lines = [
    '# 旧界面代码残留扫描报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 范围：${options.files.length ? `${options.files.length} 个指定文件` : 'src/ 全部非测试源码、样式与语言包'}${options.region ? `；区域 ${options.region}` : ''}`,
    `- 区域依据：5.1 盘点界面表（${inventoryCount} 个界面），未登记的文件按目录归区域`,
    '- 模式：报告（不阻断）。内联 style、私有 CSS 类与零引用候选需要逐条判定，计数不等于都要删',
    '',
    '## 分类汇总',
    '',
    '| 类别 | 处数 | 文件数 | 收口方式 |',
    '|---|---:|---:|---|',
    ...RESIDUE_CATEGORIES.map(({ key, label, gate }) => `| ${label} | ${summary.totals[key].count} | ${summary.totals[key].files} | ${gate} |`),
    '',
    '## 按区域',
    '',
    `| 区域 | ${RESIDUE_CATEGORIES.map(({ label }) => label).join(' | ')} |`,
    `|---|${RESIDUE_CATEGORIES.map(() => '---:').join('|')}|`,
    ...Object.entries(summary.regions).map(([region, row]) => `| ${region} | ${RESIDUE_CATEGORIES.map(({ key }) => row[key]).join(' | ')} |`),
  ]
  lines.push('', '## 各类别文件排行', '')
  for (const { key, label } of RESIDUE_CATEGORIES) {
    const ranked = summary.files.filter((entry) => entry.counts[key] > 0)
      .sort((a, b) => b.counts[key] - a.counts[key] || a.file.localeCompare(b.file)).slice(0, options.top)
    if (!ranked.length) continue
    lines.push(`### ${label}（${summary.totals[key].count} 处 / ${summary.totals[key].files} 个文件）`, '')
    for (const entry of ranked) {
      const samples = entry.findings.filter((finding) => finding.category === key).slice(0, 3)
        .map((finding) => `${finding.line ? `L${finding.line} ` : ''}\`${escapeCell(finding.text).slice(0, 80)}\``).join('，')
      lines.push(`- \`${entry.file}\`（${entry.region}${entry.surfaces.length ? ` ${entry.surfaces.join('/')}` : ''}）${entry.counts[key]}：${samples}`)
    }
    lines.push('')
  }
  lines.push('## 按文件', '', `| 文件 | 区域 | 界面 | ${RESIDUE_CATEGORIES.map(({ label }) => label).join(' | ')} |`,
    `|---|---|---|${RESIDUE_CATEGORIES.map(() => '---:').join('|')}|`)
  for (const entry of summary.files) {
    lines.push(`| \`${entry.file}\` | ${entry.region} | ${entry.surfaces.join('、') || '—'} | ${RESIDUE_CATEGORIES.map(({ key }) => entry.counts[key] || '').join(' | ')} |`)
  }
  return `${lines.join('\n')}\n`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const inventory = fs.existsSync(path.join(ROOT, INVENTORY_FILE)) ? parseRegionInventory(readText(INVENTORY_FILE)) : []
  const summary = summarize(collectFindings(options), inventory, options)
  const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.join(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const markdown = renderMarkdown(summary, options, inventory.length)
  fs.writeFileSync(path.join(outDir, 'residue-report.md'), markdown, 'utf8')
  fs.writeFileSync(path.join(outDir, 'residue-report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), options, categories: RESIDUE_CATEGORIES, ...summary,
  }, null, 2), 'utf8')
  console.log('旧界面代码残留（报告模式）')
  for (const { key, label } of RESIDUE_CATEGORIES) {
    console.log(`  ${label}：${summary.totals[key].count} 处 / ${summary.totals[key].files} 个文件`)
  }
  console.log(`\n报告：${path.join(outDir, 'residue-report.md')}`)
}

try {
  main()
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
