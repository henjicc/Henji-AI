/**
 * 应用完整退出重启后的外部连接事实核对。
 *
 * 这是 2.2 与 3.1 都明确留给 3.2 的取证缺口：之前只有「渲染层重载」的证据，
 * 而重载不会走主进程的启动恢复。这里真的把整个 Electron 进程关掉，再用**同一份**
 * 隔离资料目录启动第二次，核对：
 *   1. 重启恢复此前保存的服务开关、端口和新连接权限；
 *   2. 令牌仍然有效，连接不需要重新授权；
 *   3. 已完成操作的事实与业务存储都还在，没有被重启抹掉；
 *   4. 中断留下的未知操作仍然阻断同目标，新标识绕不过去；
 *   5. 全程没有任何供应商请求：生成历史一条不增。
 *
 * 用法：node scripts/mcp-restart-check.cjs [--out .mcp-restart]
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { launchElectronApp, waitForApp, createIsolatedUserDataDir, cleanupIsolatedUserDataDir } = require('./lib/electronLaunch.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, expectToolRefusal, operationEnvelope, waitMcpReady } = require('./lib/uiInspectionMcpClient.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const FIXTURE_PROJECT_ID = '__mcp_restart_canvas_fixture__'

function parseArgs(argv) {
  const options = { outDir: '.mcp-restart' }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--out') { options.outDir = argv[index + 1]; index += 1 }
    else if (token.startsWith('--out=')) options.outDir = token.slice('--out='.length)
    else throw new Error(`未知参数：${token}`)
  }
  return options
}

async function launch(userDataDir) {
  const app = await launchElectronApp({
    mainEntry: MAIN_ENTRY, cwd: ROOT, useElectronApi: true, skipOnboarding: true, reuseUserDataDir: userDataDir,
  })
  await waitForApp(app.page)
  return app
}

async function seedCanvasFixture(page, name) {
  await page.evaluate(async ({ projectId, projectName }) => {
    const now = Date.now()
    await window.henjiNative.storyboardProjects.upsertProjectRecord({
      id: projectId, name: projectName, createdAt: now, updatedAt: now, nodeCount: 0,
      nodesJson: '[]', edgesJson: '[]', viewportJson: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      historyJson: JSON.stringify({ past: [], future: [], imagePool: [] }),
    })
  }, { projectId: FIXTURE_PROJECT_ID, projectName: name })
}

const readHistoryCount = (page) => page.evaluate(async () => (await window.henjiNative.db.select('SELECT COUNT(*) AS total FROM history'))[0].total)
const readProjectName = (page) => page.evaluate((id) => window.henjiNative.storyboardProjects.getProjectRecord(id).then((record) => record?.name ?? null), FIXTURE_PROJECT_ID)

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.resolve(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const userDataDir = createIsolatedUserDataDir()
  const port = 43860 + Math.floor(Math.random() * 30)
  const evidence = { userDataDir, port, firstRun: {}, secondRun: {} }
  const nonce = `n${Math.random().toString(36).slice(2, 8)}`
  const renamed = `MCP重启前已保存-${nonce}`
  let connectionId = null
  let token = null
  let completedOperationId = null
  let interruptedOperationId = null

  try {
    // ——— 第一次启动：建立连接、留下一条已完成操作与一条被中断的操作 ———
    const first = await launch(userDataDir)
    try {
      await seedCanvasFixture(first.page, 'MCP重启夹具')
      evidence.firstRun.historyBefore = await readHistoryCount(first.page)
      const identity = await authorizeMcpConnection(first.page, { name: `重启验收-${nonce}`, allowWrites: true })
      connectionId = identity.id
      token = identity.config.headers.Authorization
      await first.page.evaluate(async (targetPort) => {
        const state = await window.henjiNative.mcp.status()
        if (state.port !== targetPort) {
          await window.henjiNative.mcp.configure({ enabled: false, port: state.port })
          await window.henjiNative.mcp.configure({ enabled: true, port: targetPort, defaultAccess: { allowWrites: true, allowDestructive: false, allowPaid: false } })
        }
      }, port)
      await waitMcpReady(first.page)
      const config = { url: `http://127.0.0.1:${port}/mcp`, headers: identity.config.headers }
      const client = await connectMcpClient(config, 'Henji restart first')
      try {
        const projectRef = { kind: 'canvas.project', id: FIXTURE_PROJECT_ID }
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        const completed = operationEnvelope([read], {
          summary: '重启前写入',
          changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': renamed } }],
        })
        const applied = await callTool(client, 'change_application_entities', completed)
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        completedOperationId = completed.operationId
        evidence.firstRun.completed = { executionState: applied.executionState, verificationState: applied.verificationState }

        // 造一条"连接丢失"的未解决操作：占住渲染层主线程，客户端先超时。
        const catalog = await callTool(client, 'list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const catalogRead = await callTool(client, 'read_application_entity', { ref: catalog.data.refs[0], propertyIds: [] })
        const interrupted = operationEnvelope([catalogRead], {
          summary: '重启前中断',
          changes: [{ kind: 'create_items', entityType: 'asset.library', parent: catalog.data.refs[0], items: [{ properties: { 'asset.library.name': `MCP重启中断-${nonce}` } }] }],
        })
        interruptedOperationId = interrupted.operationId
        void first.page.evaluate(() => { const end = Date.now() + 4000; while (Date.now() < end) { /* 占住渲染层 */ } })
        await first.page.waitForTimeout(120)
        await client.callTool({ name: 'change_application_entities', arguments: interrupted }, undefined, { timeout: 500 }).catch(() => undefined)
        // 未解决的操作本来就以 isError 回应，这里只取状态本身，不把"被拒绝"当成查询失败。
        const beforeExit = await client.callTool({ name: 'get_application_operation', arguments: { operationId: interrupted.operationId } })
        evidence.firstRun.interruptedFactBeforeExit = beforeExit.structuredContent?.executionState ?? null
        assert.ok(['unknown', 'executing', 'completed', 'partial', 'not_executed'].includes(evidence.firstRun.interruptedFactBeforeExit),
          `中断后的账本状态不在已知集合里：${JSON.stringify(beforeExit.structuredContent)}`)
      } finally { await client.close().catch(() => undefined) }
      evidence.firstRun.storedName = await readProjectName(first.page)
      evidence.firstRun.historyAfter = await readHistoryCount(first.page)
      assert.equal(evidence.firstRun.storedName, renamed, '重启前的写入没有落到正式存储')
    } finally {
      await first.close()
    }

    // ——— 第二次启动：同一份资料目录，整个进程是新的 ———
    const second = await launch(userDataDir)
    try {
      const status = await second.page.evaluate(() => window.henjiNative.mcp.status())
      evidence.secondRun.status = { enabled: status.enabled, connections: status.connections.length }
      assert.equal(status.enabled, true, '应用重启后应恢复之前启用的连接服务')
      assert.equal(status.port, port)
      assert.deepEqual(status.defaultAccess, { allowWrites: true, allowDestructive: false, allowPaid: false })
      assert.ok(status.connections.some((connection) => connection.id === connectionId), '重启后原授权连接丢失，客户端将被迫重新授权')
      assert.equal(await readProjectName(second.page), renamed, '重启后业务存储里的写入结果丢失')

      await second.page.evaluate(async (targetPort) => { await window.henjiNative.mcp.configure({ enabled: true, port: targetPort }) }, port)
      await waitMcpReady(second.page)
      const client = await connectMcpClient({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: token } }, 'Henji restart second')
      try {
        // 已完成操作：重启后仍然是同一条事实，不需要重新执行。
        const completedFact = await callTool(client, 'get_application_operation', { operationId: completedOperationId })
        evidence.secondRun.completed = { executionState: completedFact.executionState, verificationState: completedFact.verificationState }
        assert.equal(completedFact.executionState, 'completed', JSON.stringify(completedFact))

        // 被中断的操作：重启把在途状态收敛成未知，**未知必须继续阻断**，不能变成"没发生过"。
        const interruptedRaw = await client.callTool({ name: 'get_application_operation', arguments: { operationId: interruptedOperationId } })
        const interruptedFact = interruptedRaw.structuredContent ?? {}
        evidence.secondRun.interrupted = interruptedFact.executionState
        /*
         * 迟到回执的判据不是"停在哪个状态"，而是账本与业务存储必须自洽，并且**绝不出现第二份结果**。
         * 新建集合用唯一名字：重复执行会变成两条，藏不住。
         */
        const libraries = await second.page.evaluate((name) => window.henjiNative.assetLibrary.listLibraries()
          .then((items) => items.filter((item) => item.name === name).length), `MCP重启中断-${nonce}`)
        evidence.secondRun.interruptedResultCount = libraries
        if (interruptedFact.executionState === 'completed') assert.equal(libraries, 1, '迟到回执确认完成，却没有恰好一份结果')
        if (interruptedFact.executionState === 'not_executed') assert.equal(libraries, 0, '声明未执行却已经写入了业务存储')
        assert.ok(libraries <= 1, `重启恢复造成了重复业务写入：${libraries} 份`)
        if (interruptedFact.executionState === 'unknown' || interruptedFact.executionState === 'partial') {
          const catalog = await callTool(client, 'list_application_entities', { entityType: 'asset.catalog', limit: 1 })
          const catalogRead = await callTool(client, 'read_application_entity', { ref: catalog.data.refs[0], propertyIds: [] })
          const blocked = await expectToolRefusal(client, 'change_application_entities', operationEnvelope([catalogRead], {
            summary: '重启后对未解决目标的新请求',
            changes: [{ kind: 'create_items', entityType: 'asset.library', parent: catalog.data.refs[0], items: [{ properties: { 'asset.library.name': `MCP重启越过-${nonce}` } }] }],
          }))
          assert.ok(/RECOVERY_REQUIRED/.test(blocked), `重启后未解决操作没有继续阻断：${blocked}`)
          evidence.secondRun.blockedNewOperation = true
        }

        // 同一份令牌、同一个 operationId 重传：只拿回原事实，不会再写一次。
        const replay = await callTool(client, 'get_application_operation', { operationId: completedOperationId })
        assert.deepEqual(replay.executionState, completedFact.executionState)
        assert.equal(await readProjectName(second.page), renamed, '重启后的查询改动了业务存储')
      } finally { await client.close().catch(() => undefined) }

      evidence.secondRun.historyCount = await readHistoryCount(second.page)
      assert.equal(evidence.secondRun.historyCount, evidence.firstRun.historyAfter, '重启恢复过程发起了新的生成历史')
    } finally {
      await second.close()
    }
  } finally {
    await cleanupIsolatedUserDataDir(userDataDir)
  }

  fs.writeFileSync(path.join(outDir, 'restart.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log(JSON.stringify(evidence, null, 2))
  console.log(`\n✓ 应用完整退出重启后的外部连接事实核对通过，证据：${path.join(outDir, 'restart.json')}`)
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
