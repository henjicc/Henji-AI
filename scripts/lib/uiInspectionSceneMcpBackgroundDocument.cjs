/**
 * 核心验收场景：用户在编辑 A 工程，外部连接读改保存另一个从未打开过的 B 工程里的图片文档。
 *
 * 这一条补的是精确测试证明不了的部分。`applicationHarness.unopenedImageDocument.test.ts` 已经
 * 覆盖了目录发现、恢复原画布关联和权限预检，但它把文档加载与画布投影两个边界都换成了替身。
 * 真正要在这里取证的是那两个替身背后的东西：冷启动后没有任何内存实例时，正式加载器能不能把
 * 未挂载文档取回来；后台改完之后，画布投影能不能写回 B 的正式存储。
 *
 * 判据全部落在正式存储、正式能力返回值和真实界面上，不看任何中间日志文本。
 */
const assert = require('node:assert/strict')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

const SOURCE_LAYER_ID = 'reality-gpu-source-layer'
const BACKGROUND_OPACITY = 0.6
const BACKGROUND_NAME = '后台改名的底图'

function createMcpBackgroundDocumentScenes(context) {
  const { settlePage, setupCanvas } = context

  /** 读 B 工程正式存储里那个节点的编辑会话，判断画布预览是否跟上了文档修订。 */
  const readNodeSession = (page, projectId, nodeId) => page.evaluate(async ({ projectId, nodeId }) => {
    const record = await window.henjiNative.storyboardProjects.getProjectRecord(projectId)
    const node = JSON.parse(record.nodesJson).find((item) => item.id === nodeId)
    return { session: node?.data?.imageEditSession ?? null, name: record.name }
  }, { projectId, nodeId })

  return [{
    id: 'mcp-background-image-document', surface: '画布', name: '外部连接-未打开图片文档跨工程编辑', writesUserData: true,
    setup: async (page, _app, { capture }) => {
      /*
       * 夹具工程是直写存储再打开的。前面跑过的场景可能把这个工程的实例留在了内存里，那时
       * 打开看到的是旧节点，种进去的东西像是没生效。先重载一次，从没有任何保留实例的状态开始。
       */
      await page.reload()
      await settlePage(page, 600)
      // B：种好带 V3 文档的画布工程，但一次都不打开编辑器。
      const seeded = await openCanvasImageEditorV3Fixture({
        page, context, width: 640, height: 400, label: '后台文档底图', openEditor: false,
      })
      const step = (text) => console.log(`[MCP Reality] 后台文档：${text}`)
      step('夹具已种入 B 工程')
      const projectB = seeded.projectId
      const documentId = seeded.fixture.documentRef.replace(/^image-edit-v3:/, '')
      const nodeId = seeded.fixture.nodeId

      /*
       * 种数据时走的是直写存储，而工程实例按工程唯一保留在内存里。不重载的话，后面读到的可能
       * 是种数据之前那份内存状态，"未打开文档"这个前提就假了。重载让一切从冷启动开始。
       */
      await page.reload()
      await settlePage(page, 800)
      await setupCanvas(page)
      step('冷启动重载完成')

      const identity = await authorizeMcpConnection(page, { name: '未打开文档跨工程编辑', allowWrites: true })
      const client = await connectMcpClient(identity.config, 'Henji background document Reality')
      try {
        // A：另建一个工程并真的打开它，之后所有后台写入都不得把界面从这里带走。
        const created = await callTool(client, 'create_canvas_project', operationEnvelope([], { name: '正在编辑的A工程' }))
        const projectA = created.result.data.projectId
        assert.notEqual(projectA, projectB, '验收工程必须是两个不同工程')
        await callTool(client, 'open_canvas_project', operationEnvelope([], { projectId: projectA }))
        await page.locator('.react-flow').waitFor({ state: 'visible', timeout: 15000 })
        await settlePage(page, 600)
        /*
         * "界面还在 A"只看真实界面本身，不去翻渲染层内部状态。A 是刚建的空工程、B 带着夹具
         * 节点，所以画布上一个节点都没有就等于用户还停在 A；一旦后台写入顺手把界面切到 B，
         * B 的节点会立刻出现在这里。
         */
        const onProjectA = async (stage) => {
          await page.locator('.react-flow').waitFor({ state: 'visible', timeout: 5000 })
          assert.equal(await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).count(), 0,
            `${stage}：界面被带到了 B 工程`)
          assert.equal(await page.locator('.react-flow__node').count(), 0,
            `${stage}：A 工程的画布内容被后台写入改动了`)
        }
        step('A 工程已打开')
        await onProjectA('后台写入前')

        // 发现：文档从没被打开过，目录也必须列得出它。
        const listed = await callTool(client, 'list_application_entities', { entityType: 'image_edit.document', limit: 50 })
        const documentRef = { kind: 'image_edit.document', id: `v3:${documentId}` }
        assert.ok(listed.data.refs.some((ref) => ref.kind === documentRef.kind && ref.id === documentRef.id),
          `未打开的图片文档没有出现在目录里：${JSON.stringify(listed.data.refs)}`)

        // 读取：冷启动后靠正式加载器取回文档内容，不是靠某个还活着的编辑器会话。
        const layerRef = { kind: 'image_edit.layer', id: `v3:${documentId}:${SOURCE_LAYER_ID}` }
        const before = await callTool(client, 'read_application_entity', { ref: layerRef,
          propertyIds: ['image_edit.layer.opacity', 'image_edit.layer.name'] })
        assert.equal(before.data.properties['image_edit.layer.opacity'], 1)
        assert.equal(before.data.properties['image_edit.layer.name'], '后台文档底图')
        const documentBefore = await callTool(client, 'read_application_entity', { ref: documentRef,
          propertyIds: ['image_edit.document.revision'] })
        assert.equal(documentBefore.data.properties['image_edit.document.revision'], 0)

        // 修改并保存：一次正式操作，改两个属性。
        const args = operationEnvelope([before], { summary: '后台修改未打开文档的底图图层',
          changes: [{ kind: 'set_properties', entityType: layerRef.kind, target: layerRef,
            properties: { 'image_edit.layer.opacity': BACKGROUND_OPACITY, 'image_edit.layer.name': BACKGROUND_NAME } }] })
        step('未打开文档已读取')
        const applied = await callTool(client, 'change_application_entities', args)
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        assert.equal(applied.verificationState, 'verified', JSON.stringify(applied))
        // 同身份重传只回原事实，不得第二次改文档、也不得再推一次修订。
        assert.deepEqual(await callTool(client, 'change_application_entities', args), applied)
        await onProjectA('后台写入后')

        // 落盘：正式存储里的文档修订推进了一次，内容就是刚写的值。
        const persisted = await page.evaluate(async (documentRef) => {
          const loaded = await window.henjiNative.imageEditorV3.loadDocument({
            requestId: `reality-background-verify-${crypto.randomUUID()}`, documentRef,
          })
          const layer = loaded.document.layers.find((item) => item.id === 'reality-gpu-source-layer')
          return { revision: loaded.document.revision, opacity: layer?.opacity ?? null, name: layer?.name ?? null }
        }, seeded.fixture.documentRef)
        assert.equal(persisted.revision, 1, `后台保存必须只推进一次修订：${JSON.stringify(persisted)}`)
        assert.equal(persisted.opacity, BACKGROUND_OPACITY)
        assert.equal(persisted.name, BACKGROUND_NAME)

        // 画布预览同步：B 工程那个节点记的修订跟上了，而这一切都发生在 A 打开着的时候。
        const projected = await readNodeSession(page, projectB, nodeId)
        assert.ok(projected.session, `B 工程节点丢了编辑会话：${JSON.stringify(projected)}`)
        assert.equal(projected.session.revision, 1, `画布预览没有跟上文档修订：${JSON.stringify(projected.session)}`)
        assert.equal(projected.session.documentRef, seeded.fixture.documentRef)
        await onProjectA('落盘核对后')
        step('后台写入与落盘核对完成')
        await capture('editing-a')
      } finally {
        await client.close()
        await disableMcp(page)
      }

      // 打开 B：内容是后台改完的那份，撤销历史也接得上后台那一步。
      await setupCanvas(page)
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page, 600)
      await page.locator(`[data-project-id="${projectB}"]:visible`).click()
      const node = page.locator(`[data-layer-stack-node-id="${nodeId}"][data-layer-stack-status="editable-v3"]`)
      await node.waitFor({ state: 'visible', timeout: 15000 })
      step('已切到 B 工程')
      await node.dblclick()
      const dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      const editor = dialog.locator('[data-image-editor-v3]')
      await editor.waitFor({ state: 'visible', timeout: 60000 })
      await editor.locator(`[data-layer-id="${SOURCE_LAYER_ID}"]`).getByText(BACKGROUND_NAME).waitFor({ state: 'visible', timeout: 15000 })
      await settlePage(page, 600)
      await capture('reopened-b')

      /*
       * 撤销要撤掉的正是后台那一步，而不是"打开编辑器"这种空历史。撤完图层名回到夹具原值，
       * 说明后台写入是记进了这份文档自己的历史，而不是绕过历史直接改存储。
       */
      step('B 编辑器已打开且内容是后台改完的那份')
      await editor.getByRole('button', { name: '撤销' }).click()
      await editor.locator(`[data-layer-id="${SOURCE_LAYER_ID}"]`).getByText('后台文档底图').waitFor({ state: 'visible', timeout: 15000 })
      await settlePage(page, 400)
    },
  }]
}

/**
 * 现代 Resources 与订阅的真实回环。
 *
 * 精确测试用替身触发变更，证明的是协议实现；这里要证明的是接在真实应用上也成立：目录来自
 * 真实领域实体、内容不带本机路径、订阅只收订的那一个、真实业务写入能推出通知、关闭即释放。
 */
function createMcpResourceScenes({ setupSettings, canvasFixtureProjectId }) {
  return [{
    id: 'mcp-resources-subscription', surface: '设置', name: '外部连接-资源目录与变化订阅', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      const identity = await authorizeMcpConnection(page, { name: '资源与订阅验收', allowWrites: true })
      const client = await connectMcpClient(identity.config, 'Henji resources Reality')
      try {
        const projectRef = { kind: 'canvas.project', id: canvasFixtureProjectId }
        const projectUri = `henji://entity/canvas.project/${encodeURIComponent(canvasFixtureProjectId)}`
        const settingsUri = 'henji://entity/settings.registry/singleton'

        // 目录来自真实领域实体，不是给 MCP 单独维护的一份名单。
        const listed = await client.listResources()
        const uris = listed.resources.map((item) => item.uri)
        for (const uri of [projectUri, settingsUri]) {
          assert.ok(uris.includes(uri), `资源目录缺少 ${uri}：${uris.slice(0, 20).join('、')}`)
        }
        // SDK 默认自动翻页；逐页要显式给 cursor，这里核对首页确实是有界的。
        const firstPage = await client.request({ method: 'resources/list', params: {} }, undefined, { timeout: 15000 })
        assert.ok(firstPage.resources.length <= 50, `首页资源数量不受限：${firstPage.resources.length}`)
        await assert.rejects(client.request({ method: 'resources/list', params: { cursor: '不是游标' } }, undefined, { timeout: 15000 }))

        const read = await client.readResource({ uri: projectUri })
        const text = read.contents[0].text
        assert.equal(read.contents[0].mimeType, 'application/json')
        assert.equal(/[A-Za-z]:\|henji-media:/.test(text), false, `资源内容泄漏了本机路径：${text.slice(0, 200)}`)

        // 订阅只收订的那一个：同时盯着工程，改工程要收到，改设置不该混进来。
        const updates = []
        client.setNotificationHandler('notifications/resources/updated', (message) => { updates.push(message.params.uri) })
        const subscription = await client.listen({ resourceSubscriptions: [projectUri] })
        assert.deepEqual(subscription.honoredFilter.resourceSubscriptions, [projectUri])

        const before = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        const renamed = `资源订阅验收-${Date.now()}`
        const applied = await callTool(client, 'change_application_entities', operationEnvelope([before], {
          summary: '真实改名以触发资源变化通知',
          changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': renamed } }],
        }))
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        for (const deadline = Date.now() + 15000; !updates.includes(projectUri);) {
          if (Date.now() > deadline) throw new Error(`真实业务写入没有推出资源变化通知：${JSON.stringify(updates)}`)
          await page.waitForTimeout(100)
        }
        assert.equal(updates.includes(settingsUri), false, `未订阅的资源也收到了通知：${JSON.stringify(updates)}`)

        await subscription.close()
        assert.equal(await subscription.closed, 'local')
        const settled = updates.length
        const after = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        assert.equal(after.data.properties['canvas.project.name'], renamed)
        await callTool(client, 'change_application_entities', operationEnvelope([after], {
          summary: '关闭订阅后再改一次',
          changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': `${renamed}-2` } }],
        }))
        await page.waitForTimeout(1200)
        assert.equal(updates.length, settled, `关闭订阅后仍在收通知：${JSON.stringify(updates)}`)
      } finally {
        await client.close()
        await disableMcp(page)
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#general-mcp').scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
    },
  }]
}

module.exports = { createMcpBackgroundDocumentScenes, createMcpResourceScenes }
