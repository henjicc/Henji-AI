const fs = require('node:fs')
const path = require('node:path')
const { findDesignRules, findUnusedTokens } = require('./lib/uiDesignRules.cjs')

function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name).replace(/\\/g, '/')
    return entry.isDirectory() ? collect(file) : /\.(tsx?|css)$/.test(file) && !/\.(test|spec)\./.test(file) ? [file] : []
  })
}
const all = collect('src')
const requested = process.argv.slice(2)
if (requested.length && requested[0] !== '--files') throw new Error('只支持 --files <src 文件...>')
const selected = requested.length ? requested.slice(1).map(file => file.replace(/\\/g, '/')) : all
if (!selected.length || selected.some(file => !all.includes(file))) throw new Error('--files 必须是已有 src 源码文件')
const files = Object.fromEntries(all.map(file => [file, fs.readFileSync(file, 'utf8')]))
files['tailwind.config.js'] = fs.readFileSync('tailwind.config.js', 'utf8')
const findings = selected.flatMap(file => findDesignRules(files[file], file).map(hit => ({ ...hit, file })))
// 死令牌是跨文件契约；局部验证仍读全仓消费，但只报告本次定义文件。
findings.push(...findUnusedTokens(files).filter(hit => selected.includes(hit.file)))
for (const hit of findings) console.error(`[${hit.rule}] ${hit.file}:${hit.lineNo || 1} ${hit.value}`)
console.log(`[check:ui-design] 检查 ${selected.length} 文件，问题 ${findings.length}`)
if (findings.length) process.exitCode = 1
