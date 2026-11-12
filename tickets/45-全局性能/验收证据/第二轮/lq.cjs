// 用法: node lq.cjs <sinceISO> [untilISO|-] [summary|events] [事件名正则]
const fs = require('fs')
const [since, until0, mode = 'summary', re] = process.argv.slice(2)
const until = until0 && until0 !== '-' ? until0 : '9999'
const lines = fs.readFileSync('E:/文档/HenjiAI/.system/logs/henji-2026-11-12.log', 'utf8').split('\n')
const rx = re ? new RegExp(re) : null
const rows = []
for (const l of lines) {
  if (!l) continue
  let j; try { j = JSON.parse(l) } catch { continue }
  if (j.timestamp < since || j.timestamp > until) continue
  if (rx && !rx.test(j.event)) continue
  rows.push(j)
}
if (mode === 'events') { for (const r of rows) console.log(JSON.stringify({ t: r.timestamp.slice(11, 23), l: r.level, e: r.event, c: r.context })) }
else {
  const g = {}
  for (const r of rows) { const k = r.level.padEnd(5) + ' ' + r.event; g[k] = (g[k] || 0) + 1 }
  for (const [k, v] of Object.entries(g).sort()) console.log(v, k)
}
