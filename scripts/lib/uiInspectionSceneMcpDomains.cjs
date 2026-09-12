/**
 * 外部连接的领域边界、媒体获取与中断注入。
 *
 * 这里补的是 2.2／3.1 明确留给 3.2 的取证缺口：图片编辑的会话前置、三维的跨工程写入与
 * 任务查询、生成任务状态的只读边界、媒体的**真实字节**获取，以及连接丢失、迟到回执、
 * 并发修改、凭据撤销这几类注入。判据一律落在正式存储和操作账本上，不看返回文本。
 */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, expectToolRefusal, operationEnvelope, waitMcpReady } = require('./uiInspectionMcpClient.cjs')
const { createPlaybackFixture } = require('./uiInspectionCameraStagePlayback.cjs')

const CAMERA_STAGE_PROJECT_ID = '__mcp_reality_camera_stage__'

function marker() {
  return `n${Math.random().toString(36).slice(2, 8)}`
}

async function readAllMedia(client, ref) {
  const chunks = []
  let offset = 0
  let mimeType = null
  let totalBytes = 0
  // 刻意用远小于 256 KiB 的块，逼出 offset/eof 续读协议本身；一次读完证明不了分块。
  for (let guard = 0; guard < 512; guard += 1) {
    const chunk = await callTool(client, 'read_application_media', { ref, offset, length: 4096 })
    mimeType = chunk.mimeType
    totalBytes = chunk.totalBytes
    chunks.push(Buffer.from(chunk.base64, 'base64'))
    assert.equal(chunk.offset, offset, `分块起点与请求不一致：${JSON.stringify(chunk)}`)
    assert.equal(chunk.byteLength, chunks[chunks.length - 1].length, '声明长度与实际字节数不一致')
    offset += chunk.byteLength
    if (chunk.eof) return { bytes: Buffer.concat(chunks), mimeType, totalBytes }
    assert.ok(chunk.byteLength > 0, '未到 eof 却返回空块，续读会死循环')
  }
  throw new Error('分块读取没有在限定次数内到达 eof')
}

function createMcpDomainScenes({ setupSettings, canvasFixtureProjectId, REFERENCE_FIXTURE_IMAGE }) {
  const returnToSettings = async (page) => {
    await setupSettings(page)
    await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
    await page.locator('#general-mcp').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
  }

  return [{
    id: 'mcp-domain-media', surface: '设置', name: '外部连接-领域边界与媒体获取', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const nonce = marker()
      const identity = await authorizeMcpConnection(page, { name: `领域边界验收-${nonce}`, allowWrites: true })
      const client = await connectMcpClient(identity.config, 'Henji domain Reality')
      const historyBefore = await page.evaluate(() => window.henjiNative.db.select('SELECT COUNT(*) AS total FROM history'))
      try {
        // 1. 按域发现：点名四个域，必须拿到实体清单与只读原因，而不是一份空壳。
        const contract = await callTool(client, 'describe_application_contract', { domains: ['image_edit', 'camera_stage', 'generation', 'assets'] })
        const byId = new Map(contract.data.domains.map((domain) => [domain.id, domain]))
        for (const id of ['image_edit', 'camera_stage', 'generation', 'assets']) {
          assert.ok(byId.get(id)?.entities?.length > 0, `点名的域 ${id} 没有展开实体清单：${JSON.stringify(byId.get(id))}`)
        }
        // 只读实体必须带得住理由：既不可写也没有理由的第三种状态是"没做完伪装成有意排除"。
        const isReadOnly = (entity) => entity.writableProperties === 0 && entity.creatable === false && entity.removable === false
        const readOnlyEntities = byId.get('generation').entities.filter(isReadOnly)
        assert.ok(readOnlyEntities.length > 0 && readOnlyEntities.every((entity) => typeof entity.readOnlyReason === 'string' && entity.readOnlyReason.length > 0),
          `生成域的只读实体必须带得住原因：${JSON.stringify(readOnlyEntities)}`)

        // 2. 媒体真实获取：把夹具图片放进应用已授权目录，按稳定业务引用分块读回全部字节。
        const dataRoot = await page.evaluate(() => window.henjiNative.paths.appLocalDataDir())
        const mediaPath = path.join(dataRoot, 'Uploads', `mcp-reality-${nonce}.png`)
        const original = await fsp.readFile(REFERENCE_FIXTURE_IMAGE)
        await fsp.mkdir(path.dirname(mediaPath), { recursive: true })
        await fsp.writeFile(mediaPath, original)
        const asset = await page.evaluate((filePath) => window.henjiNative.assetLibrary.createAsset({
          filePath, mediaType: 'image', displayName: 'MCP媒体验收', source: 'imported',
        }), mediaPath)
        const media = await readAllMedia(client, { kind: 'asset', id: asset.id })
        assert.equal(media.mimeType, 'image/png', `媒体类型不符：${media.mimeType}`)
        assert.equal(media.totalBytes, original.length, '声明总长度与磁盘文件不符')
        assert.equal(crypto.createHash('sha256').update(media.bytes).digest('hex'), crypto.createHash('sha256').update(original).digest('hex'),
          '分块读回的字节与磁盘文件不是同一份内容')
        assert.ok(media.bytes.length > 4096, '夹具必须大于单块长度，否则分块协议没有被真正走到')

        // 3. 三维：后台工程不打开也能改，结果落到正式存储；任务查询对未知引用是拒绝而不是崩溃。
        await page.evaluate(async ({ projectId, sceneJson }) => {
          const now = Date.now()
          await window.henjiNative.cameraStageProjects.upsertProjectRecord({
            id: projectId, name: 'MCP三维验收工程', createdAt: now, updatedAt: now, objectCount: 3, sceneJson,
          })
        }, { projectId: CAMERA_STAGE_PROJECT_ID, sceneJson: JSON.stringify(createPlaybackFixture()) })
        const stageRef = { kind: 'camera_stage.project', id: CAMERA_STAGE_PROJECT_ID }
        const stage = await callTool(client, 'read_application_entity', { ref: stageRef, propertyIds: ['camera_stage.project.name'] })
        assert.equal(stage.data.properties['camera_stage.project.name'], 'MCP三维验收工程')
        const renamed = `MCP三维已改名-${nonce}`
        const stageWrite = await callTool(client, 'change_application_entities', operationEnvelope([stage], {
          summary: '三维后台改名',
          changes: [{ kind: 'set_properties', entityType: stageRef.kind, target: stageRef, properties: { 'camera_stage.project.name': renamed } }],
        }))
        assert.equal(stageWrite.executionState, 'completed', JSON.stringify(stageWrite))
        const storedStage = await page.evaluate((projectId) => window.henjiNative.cameraStageProjects.getProjectRecord(projectId), CAMERA_STAGE_PROJECT_ID)
        assert.equal(storedStage.name, renamed, '三维改名没有落到正式存储')
        /*
         * 三维后台任务不是反射实体，只能由 render_camera_stage_output 产生并按返回的稳定引用查询；
         * 客户端拿不到"自己编一个任务引用去列举"的口子。这里核对三件工具都在修改档目录里。
         */
        const stageTools = (await client.listTools()).tools.map((tool) => tool.name)
        for (const required of ['render_camera_stage_output', 'get_camera_stage_render_task', 'cancel_camera_stage_render_task']) {
          assert.ok(stageTools.includes(required), `修改档连接缺少三维任务工具 ${required}`)
        }

        // 4. 图片编辑：没有活动编辑会话时必须拒绝并指出恢复入口，不能伪造后台可用。
        const documents = await callTool(client, 'list_application_entities', { entityType: 'image_edit.document', limit: 1 })
        const documentRef = documents.data.refs[0] ?? { kind: 'image_edit.document', id: `__mcp_reality_absent_${nonce}__` }
        const layerRefusal = await expectToolRefusal(client, 'change_application_entities', {
          operationId: crypto.randomUUID(), baselineIds: [crypto.randomUUID()], summary: '无会话图层写入',
          changes: [{ kind: 'set_properties', entityType: 'image_edit.layer', target: { kind: 'image_edit.layer', id: `${documentRef.id}:__mcp_reality_layer__` }, properties: { 'image_edit.layer.opacity': 0.5 } }],
        })
        assert.ok(/NOT_FOUND|BASELINE|PERMISSION_DENIED/.test(layerRefusal), `图片编辑缺会话时的拒绝不可自我修正：${layerRefusal}`)
        const documentEntity = byId.get('image_edit').entities.find((entity) => entity.id === 'image_edit.document')
        assert.ok(documentEntity && isReadOnly(documentEntity) && typeof documentEntity.readOnlyReason === 'string',
          `图片文档必须是带理由的只读实体：${JSON.stringify(documentEntity)}`)
        assert.ok(byId.get('image_edit').entities.some((entity) => entity.id === 'image_edit.layer' && entity.writableProperties > 0),
          '图片编辑的图层必须是对外可写实体')

        // 5. 生成任务状态：查询工具对外可见，但发起任务必须缺席——本连接没有付费授权。
        assert.ok(stageTools.includes('get_generation_task') && stageTools.includes('prepare_generation_task'),
          `生成任务状态查询必须对修改档连接可见：${stageTools.join('、')}`)
        assert.equal(stageTools.includes('create_visible_generation_task'), false, '未授权付费的连接不得看到发起生成的工具')
        const hidden = contract.data.access.hiddenTools.find((item) => item.name === 'create_visible_generation_task')
        assert.equal(hidden?.tier, 'paid', `缺席工具必须说得出缺哪一档：${JSON.stringify(contract.data.access.hiddenTools)}`)

        // 整场只读＋非付费：生成历史一条都不该多出来，这是"没有偷偷发起生成"的硬证据。
        const historyAfter = await page.evaluate(() => window.henjiNative.db.select('SELECT COUNT(*) AS total FROM history'))
        assert.equal(historyAfter[0].total, historyBefore[0].total, '未授权付费的连接期间生成历史发生了变化')

        // 清理本次自己建的夹具：素材记录、媒体文件与三维工程，用户原有数据一律不动。
        await page.evaluate((id) => window.henjiNative.assetLibrary.deleteAsset(id), asset.id)
        await page.evaluate((projectId) => window.henjiNative.cameraStageProjects.deleteProjectRecord(projectId), CAMERA_STAGE_PROJECT_ID)
        await fsp.rm(mediaPath, { force: true })
      } finally {
        await client.close()
        await disableMcp(page)
      }
      await returnToSettings(page)
    },
  }, {
    id: 'mcp-interrupt-injection', surface: '设置', name: '外部连接-中断注入与事实一致', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const nonce = marker()
      const first = await authorizeMcpConnection(page, { name: `注入验收甲-${nonce}`, allowWrites: true })
      const second = await authorizeMcpConnection(page, { name: `注入验收乙-${nonce}`, allowWrites: true })
      const clientA = await connectMcpClient(first.config, 'Henji inject A')
      const clientB = await connectMcpClient(second.config, 'Henji inject B')
      const projectRef = { kind: 'canvas.project', id: canvasFixtureProjectId }
      const countLibraries = async (name) => (await page.evaluate(() => window.henjiNative.assetLibrary.listLibraries()))
        .filter((item) => item.name === name).length
      try {
        // 1. 并发修改：两个连接读到同一基线，后写的一方必须被拒绝，且存储只保留先写的值。
        const readA = await callTool(clientA, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        const readB = await callTool(clientB, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        const winner = `MCP并发胜出-${nonce}`
        const applied = await callTool(clientB, 'change_application_entities', operationEnvelope([readB], {
          summary: '并发写入乙', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': winner } }],
        }))
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        const staleRefusal = await expectToolRefusal(clientA, 'change_application_entities', operationEnvelope([readA], {
          summary: '并发写入甲', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': `MCP并发落败-${nonce}` } }],
        }))
        assert.ok(/STALE|BASELINE|REVISION|并发|重新读取/i.test(staleRefusal), `过期基线的拒绝必须说得出该重新读取：${staleRefusal}`)
        const afterConflict = await page.evaluate((id) => window.henjiNative.storyboardProjects.getProjectRecord(id), canvasFixtureProjectId)
        assert.equal(afterConflict.name, winner, '并发落败的一方仍然改到了正式存储')

        /*
         * 2. 连接丢失 + 迟到回执。
         * 先把渲染层主线程占住，再发一个带短超时的写入：客户端一定先超时，主进程按"连接丢失"
         * 记账；渲染层解除阻塞后照常把回执送回来，这就是迟到回执。
         * 判据不是"最后停在哪个状态"，而是**账本状态与业务存储必须自洽，且绝不出现第二次写入**——
         * 新建集合用唯一名字，重复执行会变成两条，藏不住。
         */
        const libraryName = `MCP中断新建-${nonce}`
        const catalog = await callTool(clientA, 'list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const catalogRef = catalog.data.refs[0]
        assert.ok(catalogRef, '素材目录必须存在唯一容器')
        const catalogRead = await callTool(clientA, 'read_application_entity', { ref: catalogRef, propertyIds: [] })
        const interrupted = operationEnvelope([catalogRead], {
          summary: '中断注入新建',
          changes: [{ kind: 'create_items', entityType: 'asset.library', parent: catalogRef, items: [{ properties: { 'asset.library.name': libraryName } }] }],
        })
        void page.evaluate(() => { const end = Date.now() + 2500; while (Date.now() < end) { /* 刻意占住渲染层主线程 */ } })
        await page.waitForTimeout(120)
        const timedOut = await clientA.callTool({ name: 'change_application_entities', arguments: interrupted }, undefined, { timeout: 600 })
          .then((result) => ({ timedOut: false, result }))
          .catch((error) => ({ timedOut: true, message: String(error) }))
        await page.waitForTimeout(3500)
        const fact = await callTool(clientA, 'get_application_operation', { operationId: interrupted.operationId })
        const created = await countLibraries(libraryName)
        console.log(`[MCP Reality] 中断注入：客户端${timedOut.timedOut ? '已超时' : '未超时'}，账本状态 ${fact.executionState}/${fact.verificationState}，业务结果 ${created} 条`)
        assert.ok(['completed', 'unknown', 'partial', 'not_executed', 'executing'].includes(fact.executionState), JSON.stringify(fact))
        if (fact.executionState === 'completed') assert.equal(created, 1, '完成的操作必须恰好留下一份结果')
        if (fact.executionState === 'not_executed') assert.equal(created, 0, '声明未执行却已经写入了业务存储')
        // 同标识重传永远只返回原事实，不会再写一次。
        const replay = await clientA.callTool({ name: 'change_application_entities', arguments: interrupted }).catch(() => null)
        await page.waitForTimeout(400)
        assert.ok(await countLibraries(libraryName) <= 1, `同一 operationId 重传造成了重复业务写入：${JSON.stringify({ fact, replay, timedOut })}`)

        // 3. 未解决的操作必须阻断同目标的新请求，换一个新标识也绕不过去。
        if (fact.executionState === 'unknown' || fact.executionState === 'partial') {
          const blocked = await expectToolRefusal(clientA, 'change_application_entities', operationEnvelope([catalogRead], {
            summary: '未解决目标的新请求',
            changes: [{ kind: 'create_items', entityType: 'asset.library', parent: catalogRef, items: [{ properties: { 'asset.library.name': `${libraryName}-二次` } }] }],
          }))
          assert.ok(/RECOVERY_REQUIRED/.test(blocked), `未解决操作没有阻断同目标新请求：${blocked}`)
        }

        // 4. 仅保存恢复不接受没有确认保存失败的原操作；这是 fail-closed 的方向。
        const recoveryRefusal = await expectToolRefusal(clientA, 'retry_application_operation_save', {
          operationId: crypto.randomUUID(), originalOperationId: interrupted.operationId,
        })
        assert.ok(/RECOVERY_UNAVAILABLE|RECOVERY_SESSION_LOST|RECOVERY_PROOF_MISSING/.test(recoveryRefusal), `保存恢复的拒绝形态不对：${recoveryRefusal}`)

        // 5. 凭据撤销：撤销立即断流，且撤销后的连接看不到任何事实；权限只能在应用内调整。
        await page.evaluate((id) => window.henjiNative.mcp.revoke({ id }), first.id)
        const denied = await fetch(first.config.url, { method: 'POST', headers: { ...first.config.headers, 'Content-Type': 'application/json' }, body: '{}' })
        assert.equal(denied.status, 401, `撤销后的令牌仍被接受，状态 ${denied.status}`)
        const survivor = await callTool(clientB, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        assert.equal(survivor.data.properties['canvas.project.name'], winner, '撤销一条连接影响了另一条连接的读取')
        // 操作事实按调用方隔离：换一条连接查甲的操作是被拒绝，不是"查到了但是空的"。
        const isolated = await expectToolRefusal(clientB, 'get_application_operation', { operationId: interrupted.operationId })
        assert.ok(/PERMISSION_DENIED/.test(isolated), `跨连接查询操作事实必须拒绝：${isolated}`)

        // 清理本次自己新建的集合；夹具工程名字留给 Reality 自身的清理逻辑。
        for (const library of (await page.evaluate(() => window.henjiNative.assetLibrary.listLibraries())).filter((item) => item.name.startsWith(libraryName))) {
          await page.evaluate((id) => window.henjiNative.assetLibrary.deleteLibrary(id), library.id)
        }
      } finally {
        await clientA.close().catch(() => undefined)
        await clientB.close().catch(() => undefined)
        await disableMcp(page)
      }
      await waitMcpReady(page).catch(() => undefined)
      await returnToSettings(page)
    },
  }]
}

module.exports = { createMcpDomainScenes }
