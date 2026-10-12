const fs = require('node:fs')
const path = require('node:path')
const { readCosts, writeCosts } = require('./lib/testCosts.cjs')
const directory = path.resolve(__dirname, '../.tmp/test-costs')
const historyPath = path.join(directory, 'history.json')
const history = readCosts(historyPath)
for (const file of fs.readdirSync(directory).filter((file) => /^shard-\d+\.json$/.test(file)).sort()) {
  Object.assign(history, readCosts(path.join(directory, file)))
}
writeCosts(historyPath, history)
