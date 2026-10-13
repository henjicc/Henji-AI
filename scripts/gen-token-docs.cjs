const fs = require('node:fs')
const path = require('node:path')
const loadConfig = require('tailwindcss/loadConfig')
const { RESIDUE_CATEGORIES } = require('./lib/uiResidueRules.cjs')
const START = '<!-- generated:token-values -->'
const END = '<!-- /generated:token-values -->'

function generateTokenTable(root = process.cwd()) {
  // 使用 Tailwind 自带配置加载器，避免自写 ESM/配置表达式解析。
  const { theme } = loadConfig(path.join(root, 'tailwind.config.js'))
  const eslint = JSON.parse(fs.readFileSync(path.join(root, '.eslintrc.json'), 'utf8'))
  const selectors = eslint.rules['no-restricted-syntax'].slice(1).map(rule => rule.selector).join('\n')
  const lint = (needle, label) => selectors.includes(needle) ? `ESLint ${label}` : 'ESLint 未覆盖'
  const rows = [
    ['颜色令牌', Object.keys(theme.extend.colors).join(' / '), `${lint('zinc', '固定灰色板/字面量')}；check:colors（旧别名与未定义类）`],
    ['字号/行高', Object.entries(theme.fontSize).map(([name, value]) => `${name}: ${Array.isArray(value) ? `${value[0]}/${value[1]?.lineHeight}` : value}`).join('；'), `${lint('text-', '字号任意值')}；check:ui-residue`],
    ['圆角', Object.entries(theme.borderRadius).map(([name, value]) => `${name}: ${value}`).join('；'), `${lint('rounded', 'rounded 任意值')}；check:ui-residue（嵌套层级只由 DOM oversizedRadius）`],
    ['阴影', Object.keys(theme.boxShadow).join(' / '), `${lint('shadow-', 'shadow 任意值')}；check:ui-residue（使用位置只由 DOM shadowOutsideOverlay）`],
    ['层级', Object.entries(theme.extend.zIndex).map(([name, value]) => `${name}: ${value}`).join('；'), `${lint('z-', 'z 任意值/数字类')}；check:ui-residue`],
    ['动效时长', Object.entries(theme.transitionDuration).map(([name, value]) => `${name}: ${value}`).join('；'), `${lint('duration-', 'duration')}；check:ui-design motionScale`],
    ['缓动', Object.entries(theme.extend.transitionTimingFunction).map(([name, value]) => `${name}: ${value}`).join('；'), 'check:ui-design motionEase（循环 linear 与具名 stack 例外）'],
    ['过渡属性', '显式列举；opacity / transform / colors；布局例外见 motion.md', selectors.includes('transition-all') ? 'ESLint transition-all；check:ui-design layoutTransition' : 'check:ui-design layoutTransition'],
    ['间距', fs.readFileSync(path.join(root, 'scripts/lib/uiDesignRules.cjs'), 'utf8').match(/const SPACING = new Set\(\[([^\]]+)\]/)?.[1], 'check:ui-design spacingScale；check:ui-residue（动态 var/calc 不按固定刻度判）'],
    ['残留类别', RESIDUE_CATEGORIES.map(category => `${category.key}: ${category.label}`).join('；'), 'check:ui-residue（类别与判定来源于正式规则模块）'],
  ]
  if (rows.some(row => !row[1])) throw new Error('令牌源值域缺失，不能生成空表')
  return [START, '<!-- 自动生成；修改源配置后运行 npm run gen:token-docs。门禁只说明可自动证明的范围。 -->', '| 维度 | 实际配置值域 | 自动门禁 |', '|---|---|---|', ...rows.map(row => `| ${row.join(' | ')} |`), END].join('\n')
}
function checkTokenDocs(root = process.cwd()) {
  const file = path.join(root, '.codex/skills/henji-ui-surface/references/typography-and-tokens.md')
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const block = text.match(/<!-- generated:token-values -->[\s\S]*?<!-- \/generated:token-values -->/)?.[0]
  return block === generateTokenTable(root) ? [] : ['typography-and-tokens.md 令牌生成表与源配置不一致']
}
if (require.main === module) {
  if (process.argv.includes('--check')) {
    const problems = checkTokenDocs()
    if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
    else console.log('[gen-token-docs] 令牌值域与门禁表一致')
  } else {
    for (const client of ['.codex', '.claude']) {
      const file = path.join(client, 'skills/henji-ui-surface/references/typography-and-tokens.md')
      const text = fs.readFileSync(file, 'utf8')
      const block = generateTokenTable()
      fs.writeFileSync(file, text.includes(START) ? text.replace(/<!-- generated:token-values -->[\s\S]*?<!-- \/generated:token-values -->/, block) : text + '\n\n' + block + '\n')
    }
    console.log('[gen-token-docs] 已同步两侧令牌表')
  }
}
module.exports = { generateTokenTable, checkTokenDocs }
