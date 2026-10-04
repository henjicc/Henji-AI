/**
 * 把 `ui:tour --steps` 写出的 metrics.json 按“变体 × 尺寸”汇总成可疑清单（纯函数，有精确测试）。
 * 约定的指标名（见 scripts/ui-review/generation-all-models.json）：
 *   bar（整条底栏）、row（单行收纳容器 UiOverflowRow）、more（“更多参数”浮层）、first-menu（首个参数下拉）。
 */

/**
 * 收纳容器扣掉间距后还空着这么宽，却已有选择器被收进“更多参数”，记为“接近放得下仍收起”。
 * 取值约等于一个窄下拉触发器；被收起项的真实宽度测不到（收起后不渲染），所以它只是筛选线：
 * 实测 Seedance 2.0 Fast（KIE）空余 134px，而分辨率项宽 148px，算法收起是对的，问题在收纳行本身只有 579px。
 */
const ROOM_FOR_ONE_TRIGGER_PX = 100
/** UiOverflowRow 的 gap-x-3（与 ParameterPanel 一致）。 */
const OVERFLOW_ROW_GAP_PX = 12

function suffixName(entry) {
  return entry.variant && entry.suffix.startsWith(`${entry.variant}-`) ? entry.suffix.slice(entry.variant.length + 1) : entry.suffix
}

/**
 * @param {{ size: string, variant: string|null, suffix: string, file: string, metrics: object }[]} entries
 * @param {{ captured?: Set<string> }} [options] captured：确实落盘的截图文件名（metrics 步骤不截图）
 */
function summarizeVariantMetrics(entries, { captured } = {}) {
  const groups = new Map()
  for (const entry of entries) {
    const key = `${entry.variant ?? '-'}|${entry.size}`
    const group = groups.get(key) ?? { variant: entry.variant ?? '-', size: entry.size, files: {}, metrics: {} }
    const name = suffixName(entry)
    group.metrics[name] = entry.metrics
    if (!captured || captured.has(entry.file)) group.files[name] = entry.file
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => {
    const { bar, row, more, 'first-menu': firstMenu } = group.metrics
    const flags = []
    if (bar && bar.rows > 1) flags.push(`底栏折行 ${bar.rows} 行`)
    if (bar && (bar.containerOverflow || bar.overflowingItems?.length || bar.offscreenItems?.length)) flags.push('底栏溢出')
    const truncated = [bar, more, firstMenu].flatMap((metrics) => metrics?.truncated ?? [])
    const unhinted = truncated.filter((item) => !item.hint)
    if (unhinted.length) flags.push(`截断且悬停看不全：${[...new Set(unhinted.map((item) => item.text))].slice(0, 4).join('、')}`)
    if (truncated.length > unhinted.length) flags.push(`截断（悬停可看全）${truncated.length - unhinted.length} 处`)
    const wrapped = [bar, more, firstMenu].flatMap((metrics) => metrics?.wrappedLabels ?? [])
    if (wrapped.length) flags.push(`短标签折行：${[...new Set(wrapped.map((item) => item.text))].slice(0, 4).join('、')}`)
    // 再放一项需要的间距 = 已有子元素个数 × gap（含新项前的一道）
    const free = row ? row.slack - OVERFLOW_ROW_GAP_PX * (row.childWidths?.length ?? 0) : null
    if (more && more.triggerCount > 0 && free !== null && free >= ROOM_FOR_ONE_TRIGGER_PX) {
      flags.push(`接近放得下仍收起：收纳行扣间距后空余约 ${free}px，“更多参数”里有 ${more.triggerCount} 个选择器`)
    }
    return {
      variant: group.variant,
      size: group.size,
      barRows: bar?.rows ?? null,
      rowSlack: row?.slack ?? null,
      rowWidth: row?.width ?? null,
      barTexts: bar?.texts ?? [],
      collapsedTexts: more?.texts ?? [],
      collapsedTriggers: more?.triggerCount ?? 0,
      files: group.files,
      flags,
      suspicious: flags.length > 0,
    }
  })
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/\s+/g, ' ')
}

function renderVariantSummary(rows) {
  const suspicious = rows.filter((row) => row.suspicious)
  const lines = [
    `变体 × 尺寸 ${rows.length} 行，可疑 ${suspicious.length} 行。`,
    '',
    '| 变体 | 尺寸 | 底栏行数 | 收纳行宽 / 空余 | 底栏可见 | 收进“更多参数” | 可疑原因 | 截图 |',
    '|---|---|---:|---:|---|---|---|---|',
  ]
  for (const row of rows) {
    lines.push(`| ${row.variant} | ${row.size} | ${row.barRows ?? '—'} | ${row.rowWidth === null ? '—' : `${Math.round(row.rowWidth)} / ${row.rowSlack}`} | ${markdownCell(row.barTexts.join(' · '))} | ${markdownCell(row.collapsedTexts.join(' · ') || '—')} | ${markdownCell(row.flags.join('；') || '—')} | ${Object.values(row.files).join('<br>')} |`)
  }
  return `${lines.join('\n')}\n`
}

module.exports = { ROOM_FOR_ONE_TRIGGER_PX, renderVariantSummary, summarizeVariantMetrics }

// 对已有输出目录补出汇总：node scripts/lib/uiReviewSummary.cjs .ui-tour/review/all-models
if (require.main === module) {
  const fs = require('node:fs')
  const path = require('node:path')
  const dir = process.argv[2]
  if (!dir) throw new Error('用法：node scripts/lib/uiReviewSummary.cjs <ui:tour 输出目录>')
  const metrics = JSON.parse(fs.readFileSync(path.join(dir, 'metrics.json'), 'utf8')).filter((item) => item.variant)
  const captured = new Set(fs.readdirSync(dir).filter((name) => name.endsWith('.png')))
  const summary = summarizeVariantMetrics(metrics, { captured })
  fs.writeFileSync(path.join(dir, 'variants.md'), `# 数据变体汇总\n\n${renderVariantSummary(summary)}`, 'utf8')
  console.log(`变体 × 尺寸 ${summary.length} 行，可疑 ${summary.filter((row) => row.suspicious).length} 行 → ${path.join(dir, 'variants.md')}`)
}
