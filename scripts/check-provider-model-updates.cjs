#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { inspectRegistry, resultSummary } = require('./lib/providerModelUpdates.cjs')

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'provider-model-watch.json'), 'utf8'))
const baselineData = JSON.parse(fs.readFileSync(path.join(__dirname, 'provider-model-watch-baseline.json'), 'utf8'))
const baselines = Object.fromEntries(baselineData.sources.map(source => [source.id, source]))
const args = process.argv.slice(2)
const providerArg = args.find(value => value.startsWith('--provider='))
const providers = providerArg ? providerArg.slice('--provider='.length).split(',').map(value => value.trim()).filter(Boolean) : undefined
const json = args.includes('--json')
const strict = args.includes('--strict')
const printBaseline = args.includes('--print-baseline')
const includeReviewed = args.includes('--include-reviewed')

async function main() {
  const results = await inspectRegistry(registry, baselines, { providers })
  const summary = resultSummary(results)
  if (printBaseline) {
    const output = {
      version: 1,
      checkedAt: new Date().toISOString(),
      sources: results.filter(result => result.facets).map(result => ({
        id: result.id,
        facets: Object.fromEntries(Object.entries(result.facets).map(([category, facet]) => [category, { count: facet.count, hash: facet.hash }])),
      })),
      reviewedFindings: baselineData.reviewedFindings || [],
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }
  if (json) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), summary, results, ...(includeReviewed ? { reviewedFindings: baselineData.reviewedFindings || [] } : {}) }, null, 2))
  } else {
    console.log(`[model-updates] 官网来源 ${summary.sources}：稳定 ${summary.ok}，变化 ${summary.changed}，结果不足 ${summary.inconclusive}，需登录 ${summary.requires_login}，失败 ${summary.source_error}，超时 ${summary.timeout}`)
    for (const result of results) {
      if (result.status === 'ok') continue
      if (result.status === 'changed') {
        console.log(`- [变化] ${result.provider}/${result.id}: ${result.changes.map(change => change.category).join(', ')} (${result.url})`)
        for (const change of result.changes) console.log(`  ${change.category}: ${change.current.count} 条；样例 ${change.current.sample.slice(0, 3).join(' | ') || '无'}`)
      } else {
        console.log(`- [${result.status}] ${result.provider}/${result.id}: ${result.error || (result.emptyRequired ? `缺少 ${result.emptyRequired.join(', ')} 信号；需浏览器复核 ${result.url}` : result.url)}`)
      }
    }
    if (includeReviewed) {
      console.log(`[model-updates] 已复核事项 ${baselineData.reviewedFindings?.length || 0}`)
      for (const finding of baselineData.reviewedFindings || []) console.log(`- [${finding.disposition}] ${finding.provider}: ${finding.summary}`)
    }
  }
  if (strict && (summary.changed || summary.inconclusive || summary.requires_login || summary.source_error || summary.timeout)) process.exitCode = 1
}

main().catch(error => {
  console.error(`[model-updates] ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
