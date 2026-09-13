/**
 * 应用完整退出重启后的外部连接事实核对。
 *
 * 这是 2.2 与 3.1 都明确留给 3.2 的取证缺口：之前只有「渲染层重载」的证据，
 * 而重载不会走主进程的启动恢复。这里真的把整个 Electron 进程关掉，再用**同一份**
 * 隔离资料目录启动第二次，核对：
 *   1. 重启恢复此前保存的服务开关、端口和新连接权限；
 *   2. 令牌仍然有效，连接不需要重新授权；
 *   3. 已完成操作的事实与业务存储都还在，没有被重启抹掉；
 *   4. 未知原请求换标识仍不能重放，独立追加可以继续；
 *   5. 全程没有任何供应商请求：生成历史一条不增。
 *
 * 用法：node scripts/mcp-restart-check.cjs [--out .mcp-restart]
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { once } = require('node:events')
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
  let interruptedRequest = null

  try {
    // ——— 第一次启动：建立连接、留下一条已完成操作与一条被中断的操作 ———
    const first = await launch(userDataDir)
    let debuggerSession = null
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
        evidence.firstRun.storedName = await readProjectName(first.page)
        evidence.firstRun.historyAfter = await readHistoryCount(first.page)
        assert.equal(evidence.firstRun.storedName, renamed, '重启前的写入没有落到正式存储')

        // 造一条"连接丢失"的未解决操作：占住渲染层主线程，客户端先超时。
        const catalog = await callTool(client, 'list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const catalogRead = await callTool(client, 'read_application_entity', { ref: catalog.data.refs[0], propertyIds: [] })
        const interrupted = operationEnvelope([catalogRead], {
          summary: '重启前中断',
          changes: [{ kind: 'create_items', entityType: 'asset.library', parent: catalog.data.refs[0], items: [{ properties: { 'asset.library.name': `MCP重启中断-${nonce}` } }] }],
        })
        interruptedOperationId = interrupted.operationId
        interruptedRequest = interrupted
        debuggerSession = await first.page.context().newCDPSession(first.page)
        await debuggerSession.send('Debugger.enable')
        const paused = once(debuggerSession, 'Debugger.paused', { signal: AbortSignal.timeout(10000) })
        void debuggerSession.send('Runtime.evaluate', { expression: 'debugger;' }).catch(() => undefined)
        await paused
        evidence.firstRun.rendererPaused = true
        console.log('已暂停隔离渲染线程，提交待中断操作。')
        await client.callTool({ name: 'change_application_entities', arguments: interrupted }, undefined, { timeout: 500 }).catch(() => undefined)
        // 未解决的操作本来就以 isError 回应，这里只取状态本身，不把"被拒绝"当成查询失败。
        const beforeExit = await client.callTool({ name: 'get_application_operation', arguments: { operationId: interrupted.operationId } }, undefined, { timeout: 5000 })
        evidence.firstRun.interruptedFactBeforeExit = beforeExit.structuredContent?.executionState ?? null
        assert.ok(['unknown', 'executing'].includes(evidence.firstRun.interruptedFactBeforeExit),
          `崩溃前必须实际存在未解决的在途操作：${JSON.stringify(beforeExit.structuredContent)}`)
        // 隔离应用立即退出，不触发窗口正常关闭等待；暂停的渲染层无法抢先提交迟到回执。
        await first.app.evaluate(({ app }) => { app.exit(0) }).catch(() => undefined)
        evidence.firstRun.forcedExit = true
        console.log('已中断隔离进程，重新启动核对恢复事实。')
      } finally { await client.close().catch(() => undefined) }
    } finally {
      if (!evidence.firstRun.forcedExit) {
        await debuggerSession?.send('Debugger.resume').catch(() => undefined)
        await first.close()
      }
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

        // 未知原请求不能变成“没发生过”；独立追加则不应被它锁住。
        const interruptedRaw = await client.callTool({ name: 'get_application_operation', arguments: { operationId: interruptedOperationId } })
        const interruptedFact = interruptedRaw.structuredContent ?? {}
        evidence.secondRun.interrupted = interruptedFact.executionState
        assert.equal(interruptedFact.executionState, 'unknown', '在途崩溃操作必须保持未知，不能丢失或冒称完成')
        const libraries = await second.page.evaluate((name) => window.henjiNative.assetLibrary.listLibraries()
          .then((items) => items.filter((item) => item.name === name).length), `MCP重启中断-${nonce}`)
        evidence.secondRun.interruptedResultCount = libraries
        assert.equal(libraries, 0, '暂停的原请求不应在重启后自动写入')
        {
          const catalog = await callTool(client, 'list_application_entities', { entityType: 'asset.catalog', limit: 1 })
          const catalogRead = await callTool(client, 'read_application_entity', { ref: catalog.data.refs[0], propertyIds: [] })
          const blocked = await expectToolRefusal(client, 'change_application_entities', {
            ...interruptedRequest, operationId: randomUUID(), baselineIds: [],
          })
          assert.ok(/RECOVERY_REQUIRED/.test(blocked), `重启后未解决操作没有继续阻断：${blocked}`)
          evidence.secondRun.blockedOriginalReplay = true
          const independentName = `MCP重启独立追加-${nonce}`
          const independentInput = operationEnvelope([catalogRead], {
            summary: '重启后的独立追加',
            changes: [{ kind: 'create_items', entityType: 'asset.library', parent: catalog.data.refs[0], items: [{ properties: { 'asset.library.name': independentName } }] }],
          })
          const independent = await callTool(client, 'change_application_entities', independentInput)
          assert.equal(independent.executionState, 'completed', JSON.stringify(independent))
          const independentCount = await second.page.evaluate(name => window.henjiNative.assetLibrary.listLibraries()
            .then(items => items.filter(item => item.name === name).length), independentName)
          assert.equal(independentCount, 1, '独立追加必须恰好保存一份结果')
          evidence.secondRun.independentAppendCount = independentCount
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
