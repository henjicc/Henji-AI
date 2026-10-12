const fs = require('node:fs')
const path = require('node:path')

function readCosts(filename) {
  if (!filename || !fs.existsSync(filename)) return {}
  const costs = JSON.parse(fs.readFileSync(filename, 'utf8'))
  if (!costs || Array.isArray(costs) || typeof costs !== 'object'
    || Object.values(costs).some((cost) => !Number.isFinite(cost) || cost <= 0)) throw new Error('测试成本历史必须是逐文件正数毫秒')
  return costs
}

// 最长任务优先分配给累计成本最低的片；所有片必须读同一份历史。
function balanceFiles(files, costs, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('分片数必须是正整数')
  const shards = Array.from({ length: count }, () => ({ files: [], cost: 0 }))
  const known = Object.values(costs).sort((a, b) => a - b)
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1000
  const ordered = files.map((file) => ({ file, cost: costs[file] ?? fallback }))
    .sort((a, b) => b.cost - a.cost || a.file.localeCompare(b.file, 'en'))
  for (const entry of ordered) {
    const target = shards.reduce((best, shard) => shard.cost < best.cost ? shard : best)
    target.files.push(entry.file); target.cost += entry.cost
  }
  return shards
}

function writeCosts(filename, costs) {
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, `${JSON.stringify(costs, null, 2)}\n`)
}

module.exports = { readCosts, writeCosts, balanceFiles }
