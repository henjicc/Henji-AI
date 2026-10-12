// 与 ui:tour 共用同一场景、截图和审计循环；一次启动同时产出截图与规则报告。
const { main } = require('./ui-tour.cjs')
if (require.main === module) main([...process.argv.slice(2), '--audit', '--contrast'], '.ui-audit').catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
module.exports = { main }
