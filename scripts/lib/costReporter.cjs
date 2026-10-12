const path = require('node:path')
const { writeCosts } = require('./testCosts.cjs')

module.exports = class CostReporter {
  onInit(ctx) { this.root = ctx.config.root }
  onFinished(files = []) {
    const filename = process.env.HENJI_TEST_COST_REPORT
    if (!filename) return
    const costs = {}
    for (const file of files) {
      if (file.result?.state !== 'pass') continue
      // 包含执行、收集/变换、环境与准备成本，避免只按断言时间均衡 jsdom 文件。
      const duration = (file.result.duration ?? 0) + (file.collectDuration ?? 0)
        + (file.prepareDuration ?? 0) + (file.environmentLoad ?? 0)
      if (duration > 0) costs[path.relative(this.root, file.filepath).split(path.sep).join('/')] = duration
    }
    writeCosts(filename, costs)
  }
}
