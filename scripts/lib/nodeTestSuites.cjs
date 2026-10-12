const fs = require('node:fs')
const path = require('node:path')
const suites = require('../node-test-suites.json')

function checkNodeTestOwnership(root, manifest = suites) {
  const files = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__fixtures__' || entry.name === 'node_modules') return []
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? files(file) : /\.(?:test|spec)\.[cm]js$/.test(file) ? [file] : []
  })
  const registered = Object.values(manifest).flat()
  const actual = files('scripts')
  const missing = actual.filter((file) => !registered.includes(file))
  const stale = registered.filter((file) => !actual.includes(file))
  if (new Set(registered).size !== registered.length || missing.length || stale.length) {
    throw new Error(`Node 测试归属缺失/重复/过期；缺失=${missing.join('、')}；过期=${stale.join('、')}`)
  }
  return actual.length
}

module.exports = { suites, checkNodeTestOwnership }
