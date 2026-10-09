/**
 * 旧界面代码残留扫描（任务 5.2 建立，5.8 接入门禁）。
 *
 * 按 skill henji-ui-surface references/review.md 第 3 节“代码残留”逐类统计，按文件与 5.1 盘点的区域、界面编号出报告：
 *   npm run ui:residue                         # 写 .ui-tour/residue/residue-report.{md,json}
 *   npm run ui:residue -- --out .ui-tour/residue-after-4.2
 *   npm run ui:residue -- --region 5.3         # 只看一个区域
 *   npm run ui:residue -- --files src/a.tsx,src/b.tsx
 *   npm run check:ui-residue                   # 门禁：--strict --no-report，build / electron:build / CI
 *
 * 每条命中按门禁口径（uiResidueRules.cjs 的 RESIDUE_CATEGORIES）判定为违规 / 待登记 / 合规 / 报告视图；
 * 待登记的只有在 scripts/ui-residue.allowlist.json 写了理由才放行。--strict 下有违规、未登记或过期登记即退出 1。
 */
const fs = require('node:fs')
const path = require('node:path')
const {
  RESIDUE_CATEGORIES,
  applyResidueAllowlist,
  classReferencePattern,
  extractCssClassNames,
  extractImportSpecifiers,
  finding,
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
const RESIDUE_ALLOWLIST_FILE = 'scripts/ui-residue.allowlist.json'
/** 共享样式表：其中的 ui-* 是共享组件类，不算私有（仍查零引用）。 */
const SHARED_CSS_FILE = 'src/index.css'
/** 从这些目录导入 src 的文件也算“被引用”（主进程与 preload 会引用 src/core 等共享模块）。 */
const IMPORTER_ROOTS = ['src', 'electron']
/** 只经 HTML 或构建配置进入的入口，不按 import 判死代码。 */
const ENTRY_PATTERNS = [/^src\/main\.tsx$/, /^src\/[\w-]+\/main\.tsx$/, /\.d\.ts$/, /^src\/vite-env/, /\.worker\.ts$/]

function printHelp() {
  console.log(`旧界面代码残留扫描

用法：
  npm run ui:residue [-- --out <目录>] [--region 5.3] [--files a,b] [--top 15]
  npm run check:ui-residue                     # 门禁（--strict --no-report）

  --out <目录>     报告目录，默认 .ui-tour/residue（不进仓库）
  --region <编号>  只输出某个区域（5.3 生成 / 5.4 画布 / 5.5 工具与剪辑 / 5.6 资产设置与助手 / 5.7 通用）
  --files <列表>   只扫描这些文件（逗号分隔，仓库相对路径），死代码与零引用类不统计
  --top <数量>     每个类别列出的文件数，默认 15
  --strict         有违规、未登记或过期登记时退出码 1（不能与 --region / --files 同用：局部扫描判不了过期登记）
  --no-report      不写报告文件，只在终端输出
`)
}

function parseArgs(argv) {
  const options = { outDir: '.ui-tour/residue', region: null, files: [], top: 15, help: false, strict: false, report: true }
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
    else if (token === '--strict') options.strict = true
    else if (token === '--no-report') options.report = false
    else throw new Error(`未知参数：${token}`)
  }
  if (!Number.isInteger(options.top) || options.top < 1) throw new Error('--top 必须是正整数')
  if (options.strict && (options.region || options.files.length)) throw new Error('--strict 只能全量扫描，不能与 --region / --files 同用')
  return options
}

function toRelative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

/** 把 import.meta.glob 的相对或 `/` 根模式解析成仓内相对路径正则，返回命中的已知源文件。 */
function globMatches(pattern, importer, known) {
  const base = pattern.startsWith('/') ? pattern.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(importer), pattern))
  const source = base.split(/(\*\*\/|\*)/).map((part) => (
    part === '**/' ? '(?:.*/)?' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  )).join('')
  const regex = new RegExp(`^${source}$`)
  return [...known].filter((file) => regex.test(file))
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
      add(file, Array.from({ length: count }, () => finding('colorAllowlist', 0, `${rule}（登记）`, { rule: entry.category })))
    }
  }

  // 私有 CSS 类：定义在 css 里的类，在哪些源文件里用到；零引用的作为候选
  const sourceTexts = new Map(allSources.map((file) => [file, readText(file)]))
  // 其他样式表在选择器里引用共享类（`.storyboard-frame-actions .ui-glass`）不算定义私有类
  const sharedNames = new Set(cssFiles.includes(SHARED_CSS_FILE)
    ? extractCssClassNames(readText(SHARED_CSS_FILE), { includeShared: true }) : [])
  for (const cssFile of cssFiles) {
    for (const name of extractCssClassNames(readText(cssFile), { includeShared: true })) {
      if (cssFile !== SHARED_CSS_FILE && sharedNames.has(name)) continue
      const pattern = classReferencePattern(name)
      const users = [...sourceTexts].filter(([, text]) => pattern.test(text)).map(([file]) => file)
      const shared = cssFile === SHARED_CSS_FILE && name.startsWith('ui-')
      if (!shared) {
        for (const user of users.filter(inScope)) {
          add(user, [finding('privateCssClass', 0, `.${name}（${cssFile}）`, { value: name, definedIn: cssFile })])
        }
      }
      // 共享类也可能只在样式表内部组合使用（`.ui-glass .ui-btn-quiet`），源码零引用才是死样式
      if (!scoped && users.length === 0) add(cssFile, [finding('unusedCssClass', 0, `.${name}`)])
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
      const text = readText(importer)
      for (const specifier of extractImportSpecifiers(text)) {
        const resolved = resolveImport(specifier, importer, known)
        if (resolved && resolved !== importer) target.add(resolved)
      }
      // Vite import.meta.glob 自动发现的入口（如工具箱 toolboxTools/*/entry.ts）同样算被引用
      for (const match of text.matchAll(/import\.meta\.glob(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`]/g)) {
        for (const file of globMatches(match[1], importer, known)) if (file !== importer) target.add(file)
      }
    }
    for (const html of walk(ROOT, (name, full) => name.endsWith('.html') && !full.includes(`${path.sep}out${path.sep}`)
      && !full.includes(`${path.sep}release${path.sep}`) && !full.includes(`${path.sep}docs${path.sep}`))) {
      for (const match of fs.readFileSync(html, 'utf8').matchAll(/src="\/?([^"]+\.tsx?)"/g)) referencedByCode.add(match[1])
    }
    // 只统计界面代码（组件与界面目录里的 .tsx、组件/工作区目录的 .ts）；core 与应用服务的死代码不属于本扫描
    for (const file of allSources.filter(isUiSource)) {
      if (referencedByCode.has(file) || ENTRY_PATTERNS.some((pattern) => pattern.test(file))) continue
      add(file, [finding(referencedByTests.has(file) ? 'testOnlyCode' : 'deadCode', 0, file)])
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
    `- 门禁：违规 ${summary.gate.violations.length}，未登记 ${summary.gate.unregistered.length}，登记文件问题 ${summary.gate.allowlistErrors.length}`
      + `（\`npm run check:ui-residue\` 严格模式；登记文件 ${RESIDUE_ALLOWLIST_FILE}）`,
    '',
    '## 分类汇总',
    '',
    '| 类别 | 处数 | 文件数 | 违规 | 未登记 | 已登记 | 按口径合规 | 门禁口径 |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...RESIDUE_CATEGORIES.map(({ key, label, gate }) => {
      const verdicts = summary.verdicts[key]
      return `| ${label} | ${summary.totals[key].count} | ${summary.totals[key].files} | ${verdicts.violation} | ${verdicts.register} | ${verdicts.registered} | ${verdicts.allowed} | ${gate} |`
    }),
    '',
    '## 按区域',
    '',
    `| 区域 | ${RESIDUE_CATEGORIES.map(({ label }) => label).join(' | ')} |`,
    `|---|${RESIDUE_CATEGORIES.map(() => '---:').join('|')}|`,
    ...Object.entries(summary.regions).map(([region, row]) => `| ${region} | ${RESIDUE_CATEGORIES.map(({ key }) => row[key]).join(' | ')} |`),
  ]
  const gateItems = [...summary.gate.violations, ...summary.gate.unregistered]
  if (gateItems.length || summary.gate.allowlistErrors.length) {
    lines.push('', '## 门禁未通过', '')
    for (const item of summary.gate.allowlistErrors) lines.push(`- 登记文件：${escapeCell(item)}`)
    for (const item of gateItems) lines.push(`- ${escapeCell(formatGateItem(item))}`)
  }
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

function formatGateItem(item) {
  const kind = item.verdict === 'violation' ? '违规' : '未登记'
  return `${kind} ${item.file}${item.line ? `:${item.line}` : ''} [${item.category}] ${item.rule ? `${item.rule}：` : ''}${item.value}`
}

/** 门禁结论：违规与未登记逐条列出；登记文件的格式、理由与过期问题单列。 */
function evaluateGate(byFile, options) {
  const allowlist = JSON.parse(readText(RESIDUE_ALLOWLIST_FILE))
  const { errors } = applyResidueAllowlist(byFile, allowlist)
  // 局部扫描（--files / --region）看不到全部使用方，过期登记判不了，只保留格式与理由问题
  const scoped = options.files.length > 0 || Boolean(options.region)
  const allowlistErrors = scoped ? errors.filter((error) => !/已不存在|已没有使用方/.test(error)) : errors
  const items = [...byFile].flatMap(([file, findings]) => findings.map((item) => ({ file, ...item })))
  return {
    violations: items.filter((item) => item.verdict === 'violation'),
    unregistered: items.filter((item) => item.verdict === 'register'),
    allowlistErrors,
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const inventory = fs.existsSync(path.join(ROOT, INVENTORY_FILE)) ? parseRegionInventory(readText(INVENTORY_FILE)) : []
  const byFile = collectFindings(options)
  const gate = evaluateGate(byFile, options)
  const summary = summarize(byFile, inventory, options)
  const inRegion = (item) => summary.files.some((entry) => entry.file === item.file)
  summary.gate = options.region
    ? { ...gate, violations: gate.violations.filter(inRegion), unregistered: gate.unregistered.filter(inRegion) }
    : gate
  summary.verdicts = Object.fromEntries(RESIDUE_CATEGORIES.map(({ key }) => {
    const counts = { violation: 0, register: 0, registered: 0, allowed: 0, info: 0 }
    for (const entry of summary.files) for (const item of entry.findings) if (item.category === key) counts[item.verdict] += 1
    return [key, counts]
  }))
  if (options.report) {
    const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.join(ROOT, options.outDir)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'residue-report.md'), renderMarkdown(summary, options, inventory.length), 'utf8')
    fs.writeFileSync(path.join(outDir, 'residue-report.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), options, categories: RESIDUE_CATEGORIES, ...summary,
    }, null, 2), 'utf8')
    console.log('旧界面代码残留')
    for (const { key, label } of RESIDUE_CATEGORIES) {
      const verdicts = summary.verdicts[key]
      console.log(`  ${label}：${summary.totals[key].count} 处 / ${summary.totals[key].files} 个文件`
        + `（违规 ${verdicts.violation}，未登记 ${verdicts.register}，已登记 ${verdicts.registered}，合规 ${verdicts.allowed}）`)
    }
    console.log(`\n报告：${path.join(outDir, 'residue-report.md')}`)
  }
  const failing = summary.gate.violations.length + summary.gate.unregistered.length + summary.gate.allowlistErrors.length
  if (!failing) {
    console.log('[ui-residue] 门禁通过：无违规、无未登记、登记文件无过期条目。')
    return
  }
  const list = [...summary.gate.allowlistErrors.map((item) => `登记文件：${item}`),
    ...[...summary.gate.violations, ...summary.gate.unregistered].map(formatGateItem)]
  const print = options.strict ? console.error : console.log
  print(`\n[ui-residue] 门禁未通过 ${failing} 项${options.strict ? '' : '（报告模式不阻断）'}：`)
  for (const item of options.strict ? list : list.slice(0, 20)) print(`  ${item}`)
  if (!options.strict && list.length > 20) print(`  …其余 ${list.length - 20} 项见报告`)
  if (options.strict) {
    print(`\n违规必须改掉；固定几何尺寸、字面量内联尺寸、私有 CSS 变量/写死值与私有 CSS 类确有理由时登记到 ${RESIDUE_ALLOWLIST_FILE}（理由 ≥ 8 字）。`)
    process.exitCode = 1
  }
}

try {
  main()
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
