import path from 'node:path'
import { createRequire } from 'node:module'
import { BaseSequencer } from 'vitest/node'
const costs = createRequire(import.meta.url)('./testCosts.cjs')

export default class CostSequencer extends BaseSequencer {
  async sort(specs) {
    if (!process.env.HENJI_TEST_COSTS) return super.sort(specs)
    const history = costs.readCosts(process.env.HENJI_TEST_COSTS)
    const relative = (file) => path.relative(this.ctx.config.root, file).split(path.sep).join('/')
    return [...specs].sort((a, b) => (history[relative(b[1])] ?? 0) - (history[relative(a[1])] ?? 0)
      || relative(a[1]).localeCompare(relative(b[1]), 'en'))
  }
  async shard(specs) {
    if (!process.env.HENJI_TEST_COSTS) return super.shard(specs)
    const { index, count } = this.ctx.config.shard
    const root = this.ctx.config.root
    const relative = (file) => path.relative(root, file).split(path.sep).join('/')
    const history = costs.readCosts(process.env.HENJI_TEST_COSTS)
    const shards = costs.balanceFiles(specs.map(([, file]) => relative(file)), history, count)
    const selected = new Set(shards[index - 1].files)
    return specs.filter(([, file]) => selected.has(relative(file)))
  }
}
