const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { validateNativeReport, runNativePersistence, OUTPUT_LIMIT_BYTES } = require('../test-assistant-persistence.cjs')

const ROOT = path.resolve(__dirname, '../..')
const FILES = ['fixture-a.test.ts', 'fixture-b.test.ts']
function report(files = FILES) {
  return { success: true, numTotalTests: files.length, numPassedTests: files.length,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: files.map((name) => ({ name: path.join(ROOT, name), status: 'passed',
      assertionResults: [{ fullName: `${name}真实结果`, status: 'passed', failureMessages: [] }] })) }
}

test('报告必须覆盖唯一清单且每项真执行，不硬编码历史用例数', () => {
  assert.deepEqual(validateNativeReport(report(), FILES), { files: 2, passed: 2 })
  const more = report(); more.testResults[0].assertionResults.push({ fullName: '新增结果', status: 'passed' })
  more.numTotalTests += 1; more.numPassedTests += 1
  assert.deepEqual(validateNativeReport(more, FILES), { files: 2, passed: 3 })
  assert.throws(() => validateNativeReport(report([]), FILES), /文件清单/)
  assert.throws(() => validateNativeReport(report([FILES[0]]), FILES), /文件清单/)
  assert.throws(() => validateNativeReport(report([FILES[0], FILES[0]]), FILES), /文件清单/)
  assert.throws(() => validateNativeReport(report([...FILES, 'extra.ts']), FILES), /文件清单/)
  for (const status of ['pending', 'skipped', 'todo', 'failed']) {
    const bad = report(); bad.testResults[0].assertionResults[0].status = status
    assert.throws(() => validateNativeReport(bad, FILES), /跳过或待办/)
  }
  const empty = report(); empty.testResults[0].assertionResults = []
  assert.throws(() => validateNativeReport(empty, FILES), /没有执行/)
  const counts = report(); counts.numTotalTests = 0
  assert.throws(() => validateNativeReport(counts, FILES), /统计/)
  assert.throws(() => validateNativeReport({ ...report(), numPendingTests: 1 }, FILES), /未通过项/)
})

function launchFixture(source, options = {}) {
  let directory
  const promise = runNativePersistence({ executable: process.execPath, root: ROOT, testFiles: FILES,
    timeoutMs: 2000,
    createArguments: (file) => ['-e', source, file, JSON.stringify(report())],
    onDirectory: (value) => { directory = value }, ...options,
    // Windows must launch taskkill; match the production cleanup allowance.
    // The fixture timeout remains short, and process/cleanup assertions remain mandatory.
    graceMs: process.platform === 'win32' ? Math.max(options.graceMs ?? 250, 2000) : options.graceMs ?? 250 })
  return { promise, directory: () => directory }
}

const writeReport = "require('node:fs').writeFileSync(process.argv[1], process.argv[2]);"

test('只有子进程正常结束且报告有效才通过，之后才删除临时目录', async () => {
  const fixture = launchFixture(`${writeReport}setTimeout(() => process.exit(0), 60)`)
  assert.equal(fs.existsSync(fixture.directory()), true)
  assert.deepEqual(await fixture.promise, { files: 2, passed: 2 })
  assert.equal(fs.existsSync(fixture.directory()), false)
})

test('提前退出、报告缺失、坏JSON与伪造成功报告但非0退出都必须及时失败', async () => {
  for (const source of ['process.exit(0)', 'process.exit(3)',
    "require('node:fs').writeFileSync(process.argv[1], '{broken');",
    `${writeReport}process.exit(7)`]) {
    const fixture = launchFixture(source)
    await assert.rejects(fixture.promise)
    assert.equal(fs.existsSync(fixture.directory()), false)
  }
  const unavailable = launchFixture('', { executable: path.join(ROOT, 'nonexistent-native-test-executable') })
  await assert.rejects(unavailable.promise, /ENOENT/)
  assert.equal(fs.existsSync(unavailable.directory()), false)
})

test('stdout/stderr只保留有界尾部且不挤掉异常退出原因', async () => {
  const fixture = launchFixture("process.stderr.write('x'.repeat(50000) + '末尾原因'); process.exitCode=9")
  await assert.rejects(fixture.promise, (error) => {
    assert.match(error.message, /code=9/)
    assert.match(error.message, /末尾原因/)
    assert.ok(Buffer.byteLength(error.message) <= OUTPUT_LIMIT_BYTES + 1)
    return true
  })
})

test('非零退出保留JSON报告内的断言失败，清理后仍能定位根因', async () => {
  const fixture = launchFixture(`
    const report = JSON.parse(process.argv[2]); report.success = false;
    report.testResults[0].assertionResults[0].status = 'failed';
    report.testResults[0].assertionResults[0].failureMessages = ['expected original record to remain unchanged'];
    require('node:fs').writeFileSync(process.argv[1], JSON.stringify(report)); process.exit(1);
  `)
  await assert.rejects(fixture.promise, (error) => {
    assert.match(error.message, /code=1/)
    assert.match(error.message, /fixture-a.test.ts真实结果/)
    assert.match(error.message, /expected original record to remain unchanged/)
    return true
  })
  assert.equal(fs.existsSync(fixture.directory()), false)
})

test('报告已生成但子进程挂住不能提前报绿，超时结束后才清理目录', async () => {
  const fixture = launchFixture(`${writeReport}process.on('SIGTERM', () => {}); process.stderr.write('报告已写且等待中'); setInterval(() => {}, 1000)`,
    { timeoutMs: 1000, graceMs: 100 })
  await assert.rejects(fixture.promise, (error) => {
    assert.match(error.message, /超时/)
    assert.match(error.message, /报告已写且等待中/)
    return true
  })
  assert.equal(fs.existsSync(fixture.directory()), false)
})

test('取消正在执行的子进程会收尾，预先取消不创建目录', async () => {
  const controller = new AbortController()
  const fixture = launchFixture('setInterval(() => {}, 1000)', { signal: controller.signal })
  setTimeout(() => controller.abort(), 60)
  await assert.rejects(fixture.promise, /已取消/)
  assert.equal(fs.existsSync(fixture.directory()), false)
  let created = false
  await assert.rejects(runNativePersistence({ executable: process.execPath, signal: controller.signal,
    onDirectory: () => { created = true } }), /已取消/)
  assert.equal(created, false)
})

test('超时前的SIGTERM处理仍能写报告目录，不能先删目录再杀进程', async () => {
  const fixture = launchFixture("process.on('SIGTERM', () => { require('node:fs').writeFileSync(process.argv[1], 'closing'); process.stderr.write('目录仍存在'); process.exit(0) }); setInterval(() => {}, 1000)",
    { timeoutMs: 1000, graceMs: 300 })
  await assert.rejects(fixture.promise, (error) => {
    assert.match(error.message, /超时/)
    if (process.platform !== 'win32') assert.match(error.message, /目录仍存在/)
    return true
  })
  assert.equal(fs.existsSync(fixture.directory()), false)
})

test('取消只收本次spawn的进程树，子孙退出后再删除目录', async () => {
  const controller = new AbortController()
  const fixture = launchFixture(`
    const fs = require('node:fs'); const path = require('node:path');
    const child = require('node:child_process').spawn(process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    process.on('SIGTERM', () => { child.once('exit', () => process.exit(0)); child.kill('SIGTERM') });
    fs.writeFileSync(path.join(path.dirname(process.argv[1]), 'child.json'), JSON.stringify({ pid: child.pid }));
    setInterval(() => {}, 1000);
  `, { signal: controller.signal, timeoutMs: 5000, graceMs: 500 })
  fixture.promise.catch(() => undefined)
  try {
    const childPath = path.join(fixture.directory(), 'child.json')
    const deadline = Date.now() + 3000
    while (!fs.existsSync(childPath) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(fs.existsSync(childPath), true, '子进程未进入受控就绪状态')
    const { pid } = JSON.parse(fs.readFileSync(childPath, 'utf8'))
    controller.abort()
    await assert.rejects(fixture.promise, /已取消/)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    assert.equal(fs.existsSync(fixture.directory()), false)
  } finally {
    controller.abort()
    await fixture.promise.catch(() => undefined)
  }
})
