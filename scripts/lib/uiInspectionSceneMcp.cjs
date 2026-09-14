const assert = require('node:assert/strict')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

// 只读连接必须始终看得到的读取工具，以及任何情况下都不得出现在只读清单里的写入工具。
const REQUIRED_READ_TOOLS = ['describe_application_contract', 'describe_application_entities', 'list_application_entities', 'read_application_entity', 'read_application_media']
const WRITE_TOOLS = ['change_application_entities', 'create_visible_generation_task', 'cancel_generation_task',
  'render_camera_stage_output', 'cancel_camera_stage_render_task', 'add_generation_result_to_canvas',
  'get_application_operation', 'retry_application_operation_save']

function createMcpScenes({ setupSettings, canvasFixtureProjectId }) {
  const setSwitch = async (page, index, value) => {
    const control = page.locator('#general-mcp').getByRole('switch').nth(index)
    if ((await control.getAttribute('aria-checked')) !== String(value)) await control.click()
    await page.waitForFunction(({ index, value }) => document.querySelectorAll('#general-mcp [role="switch"]')[index]?.getAttribute('aria-checked') === String(value), { index, value })
  }
  const waitReady = async (page) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await page.evaluate(async () => (await window.henjiNative.mcp.status()).ready)) return
      await page.waitForTimeout(100)
    }
    throw new Error('应用宿主未在限定时间内就绪')
  }
  /** 用名单而不是数量断言：新增读取工具不该让验收变红，写入工具泄漏必须红。 */
  const assertReadOnlyTools = (names) => {
    for (const required of REQUIRED_READ_TOOLS) assert.ok(names.includes(required), `只读连接缺少读取工具 ${required}：${names.join('、')}`)
    for (const write of WRITE_TOOLS) assert.equal(names.includes(write), false, `只读连接不能看到写入工具 ${write}`)
  }
  return [{ id: 'mcp-read-lifecycle', surface: '设置', name: '外部连接-只读与重载', writesUserData: true,
    setup: async (page) => {
      await page.evaluate(() => window.henjiNative.assetLibrary.createLibrary('MCP隔离验收素材库'))
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const initial = await page.evaluate(() => window.henjiNative.mcp.status())
      assert.deepEqual(initial.defaultAccess, { allowWrites: true, allowDestructive: true, allowPaid: true })
      const section = page.locator('#general-mcp')
      if (!initial.enabled) await section.getByRole('switch').first().click()
      await setSwitch(page, 1, false)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: /设置|Settings/ }).waitFor({ state: 'hidden' })
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      assert.equal(await section.getByRole('switch').nth(1).isChecked(), false)
      await section.getByPlaceholder('例如：Codex').fill('协议验收客户端')
      await section.getByRole('button', { name: '创建授权' }).click()
      await section.getByRole('button', { name: '复制连接配置' }).waitFor()
      await waitReady(page)
      const connection = await page.evaluate(async () => {
        const status = await window.henjiNative.mcp.status()
        const identity = status.connections.find((item) => item.name === '协议验收客户端')
        return { id: identity.id, config: JSON.parse(await window.henjiNative.mcp.connectionConfig({ id: identity.id })).mcpServers.henji }
      })
      const connect = async () => {
        const client = new Client({ name: 'Henji Reality', version: '1' })
        await client.connect(new StreamableHTTPClientTransport(new URL(connection.config.url), { requestInit: { headers: connection.config.headers } }))
        return client
      }
      let client = await connect()
      try {
        assertReadOnlyTools((await client.listTools()).tools.map((tool) => tool.name))
        const described = await client.callTool({ name: 'describe_application_entities', arguments: { entityTypes: ['settings.registry', 'asset.library', 'canvas.project', 'generation.model'] } })
        assert.equal(described.isError, false, JSON.stringify(described))
        for (const entityType of ['settings.registry', 'asset.library', 'canvas.project', 'generation.model']) {
          console.log(`[MCP Reality] 读取 ${entityType}`)
          const listed = await client.callTool({ name: 'list_application_entities', arguments: { entityType, limit: 5 } })
          assert.equal(listed.isError, false, JSON.stringify(listed))
          const refs = listed.structuredContent.data.refs
          assert.ok(refs.length > 0, `${entityType} 必须存在真实实例`)
          const ref = entityType === 'canvas.project' ? refs.find((item) => item.id === canvasFixtureProjectId) : refs[0]
          assert.ok(ref, `${entityType} 夹具引用存在`)
          const propertyIds = described.structuredContent.data.properties.filter((property) => property.entityType === entityType).slice(0, 3).map((property) => property.id)
          assert.ok(propertyIds.length > 0, `${entityType} 必须有授权可读字段`)
          const read = await client.callTool({ name: 'read_application_entity', arguments: { ref, propertyIds } })
          assert.equal(read.isError, false, JSON.stringify(read))
          assert.ok(Object.keys(read.structuredContent.data.properties).length > 0, `${entityType} 必须读回字段值`)
        }
        await page.reload()
        console.log('[MCP Reality] 等待重载宿主')
        await waitReady(page)
        assertReadOnlyTools((await client.listTools()).tools.map((tool) => tool.name))
        const after = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'] } })
        assert.equal(after.isError, false)
        await client.close()
        console.log('[MCP Reality] 同页面关闭再开启')
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }); await window.henjiNative.mcp.configure({ enabled: true, port: state.port }) })
        client = await connect()
        assertReadOnlyTools((await client.listTools()).tools.map((tool) => tool.name))
        await page.evaluate((id) => window.henjiNative.mcp.revoke({ id }), connection.id)
        const denied = await fetch(connection.config.url, { headers: connection.config.headers })
        assert.equal(denied.status, 401)
      } finally {
        await client.close()
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }) })
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#general-mcp').scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
    },
  }, { id: 'mcp-write-recovery', surface: '设置', name: '外部连接-受控写入与事实保留', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const section = page.locator('#general-mcp')
      await setSwitch(page, 0, true)
      await setSwitch(page, 1, true)
      await setSwitch(page, 2, true)
      await section.getByPlaceholder('例如：Codex').fill('受控写入验收')
      await section.getByRole('button', { name: '创建授权' }).click()
      await waitReady(page)
      const config = await page.evaluate(async () => {
        const state = await window.henjiNative.mcp.status()
        const connection = state.connections.find((item) => item.name === '受控写入验收')
        return JSON.parse(await window.henjiNative.mcp.connectionConfig({ id: connection.id })).mcpServers.henji
      })
      const client = new Client({ name: 'Henji write Reality', version: '1' })
      const operations = []
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args })
        assert.equal(result.isError, false, JSON.stringify(result))
        return result.structuredContent
      }
      const read = (ref, propertyIds) => call('read_application_entity', { ref, propertyIds })
      const change = async (changes, reads) => {
        const args = { operationId: require('node:crypto').randomUUID(), ...(changes.some(change => change.kind === 'remove_items') ? { baselineIds: reads.map((item) => item.baselineId) } : {}), summary: '隔离验收修改', changes }
        const result = await call('change_application_entities', args)
        assert.equal(result.executionState, 'completed', JSON.stringify(result))
        assert.equal(result.verificationState, 'verified', JSON.stringify(result))
        const repeated = await call('change_application_entities', args)
        assert.deepEqual(repeated, result)
        operations.push(args.operationId)
        return result
      }
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }))
        const settingsRef = { kind: 'settings.registry', id: 'singleton' }
        const settings = await read(settingsRef, ['interface.theme_tone'])
        const theme = settings.data.properties['interface.theme_tone'] === 'warm' ? 'cool' : 'warm'
        await change([{ kind: 'set_properties', entityType: settingsRef.kind, target: settingsRef, properties: { 'interface.theme_tone': theme } }], [settings])
        assert.equal((await read(settingsRef, ['interface.theme_tone'])).data.properties['interface.theme_tone'], theme)
        const models = await call('list_application_entities', { entityType: 'generation.model', limit: 1 })
        const modelRef = models.data.refs[0]; assert.ok(modelRef)
        const model = await read(modelRef, ['generation.model.hidden', 'generation.model.provider_id'])
        const hidden = !model.data.properties['generation.model.hidden']
        await change([{ kind: 'set_properties', entityType: modelRef.kind, target: modelRef, properties: { 'generation.model.hidden': hidden } }], [model])
        assert.equal((await read(modelRef, ['generation.model.hidden'])).data.properties['generation.model.hidden'], hidden)
        const catalog = await call('list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const catalogRef = catalog.data.refs[0]; assert.ok(catalogRef)
        const created = await change([{ kind: 'create_items', entityType: 'asset.library', parent: catalogRef, items: [{ properties: { 'asset.library.name': 'MCP新建集合' } }] }], [catalog])
        const libraryRef = created.result.data.resultRefs.find((item) => item.kind === 'asset.library'); assert.ok(libraryRef)
        const library = await read(libraryRef, ['asset.library.name'])
        assert.equal(library.data.properties['asset.library.name'], 'MCP新建集合')
        await change([{ kind: 'set_properties', entityType: 'asset.library', target: libraryRef, properties: { 'asset.library.name': 'MCP已改名集合' } }], [library])
        assert.equal((await read(libraryRef, ['asset.library.name'])).data.properties['asset.library.name'], 'MCP已改名集合')
        const projectRef = { kind: 'canvas.project', id: canvasFixtureProjectId }
        const project = await read(projectRef, ['canvas.project.name'])
        await change([{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': 'MCP已保存画布' } }], [project])
        assert.equal((await read(projectRef, ['canvas.project.name'])).data.properties['canvas.project.name'], 'MCP已保存画布')
        // 直接检查正式存储，不把协议 ok 当作持久化证据。
        const stored = await page.evaluate(async ({ libraryId, projectId }) => ({
          libraries: await window.henjiNative.assetLibrary.listLibraries(),
          settings: JSON.parse(localStorage.getItem('settings-storage')),
          hiddenModels: localStorage.getItem('hidden_models'),
          project: await window.henjiNative.storyboardProjects.getProjectRecord(projectId),
        }), { libraryId: libraryRef.id, projectId: canvasFixtureProjectId })
        const storedLibrary = stored.libraries.find((item) => String(item.id) === String(libraryRef.id))
        assert.ok(storedLibrary, `正式素材库缺少结果引用：${JSON.stringify({ libraryRef, libraries: stored.libraries })}`)
        assert.equal(storedLibrary.name, 'MCP已改名集合')
        assert.equal(stored.settings.state.themeTonePreset, theme)
        assert.equal(JSON.parse(stored.hiddenModels).includes(`${model.data.properties['generation.model.provider_id']}-${modelRef.id}`), hidden)
        assert.ok(stored.project, `正式画布存储缺少工程：${canvasFixtureProjectId}`)
        assert.equal(stored.project.name, 'MCP已保存画布')
        const freshCatalog = await call('list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const freshLibrary = await read(libraryRef, ['asset.library.name'])
        const unboundDelete = await client.callTool({ name: 'change_application_entities', arguments: { operationId: require('node:crypto').randomUUID(), summary: '删除必须核对', changes: [{ kind: 'remove_items', entityType: 'asset.library', parent: catalogRef, targets: [libraryRef] }] } })
        assert.equal(unboundDelete.isError, true)
        assert.equal((await page.evaluate(() => window.henjiNative.assetLibrary.listLibraries())).some(item => item.id === libraryRef.id), true)
        await change([{ kind: 'remove_items', entityType: 'asset.library', parent: catalogRef, targets: [libraryRef] }], [freshCatalog, freshLibrary])
        const remaining = await page.evaluate(() => window.henjiNative.assetLibrary.listLibraries())
        assert.equal(remaining.some((item) => String(item.id) === String(libraryRef.id)), false)
        await page.reload(); await waitReady(page)
        for (const operationId of operations) assert.equal((await call('get_application_operation', { operationId })).executionState, 'completed')
        const stale = await client.callTool({ name: 'change_application_entities', arguments: { operationId: require('node:crypto').randomUUID(), baselineIds: [project.baselineId], summary: '过期基线拒绝', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': '不能写入' } }] } })
        assert.equal(stale.isError, true)
      } finally {
        await client.close()
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }) })
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#general-mcp').scrollIntoViewIfNeeded()
    },
  }, { id: 'mcp-background-crossdomain', surface: '设置', name: '外部连接-后台任务与跨域保存', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const section = page.locator('#general-mcp')
      // 只开「修改」，不开删除、不开付费生成：本场景禁止任何供应商请求。
      await setSwitch(page, 0, true)
      await setSwitch(page, 1, true)
      await setSwitch(page, 2, false)
      await setSwitch(page, 3, false)
      await section.getByPlaceholder('例如：Codex').fill('后台跨域验收')
      await section.getByRole('button', { name: '创建授权' }).click()
      await waitReady(page)
      const identity = await page.evaluate(async () => {
        const state = await window.henjiNative.mcp.status()
        const connection = state.connections.find((item) => item.name === '后台跨域验收')
        return { allowPaid: connection.allowPaid === true, allowDestructive: connection.allowDestructive === true,
          config: JSON.parse(await window.henjiNative.mcp.connectionConfig({ id: connection.id })).mcpServers.henji }
      })
      assert.equal(identity.allowPaid, false, '本场景必须使用未授权付费的连接')
      assert.equal(identity.allowDestructive, false)
      const client = new Client({ name: 'Henji background Reality', version: '1' })
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args })
        assert.equal(result.isError, false, JSON.stringify(result))
        return result.structuredContent
      }
      // 未打开画布工作区：整个场景都停在设置界面，用它证明后台写入不需要切页。
      const assertStillOnSettings = async (stage) => {
        assert.equal(await page.locator('.react-flow').count(), 0, `${stage}：后台写入把界面切到了画布`)
        assert.equal(await page.getByRole('dialog', { name: /设置|Settings/i }).isVisible(), true, `${stage}：设置界面已被替换`)
      }
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(identity.config.url), { requestInit: { headers: identity.config.headers } }))
        const tools = (await client.listTools()).tools.map((tool) => tool.name)
        for (const required of ['change_application_entities', 'get_application_operation', 'retry_application_operation_save',
          'read_application_media', 'get_generation_task', 'get_camera_stage_render_task']) {
          assert.ok(tools.includes(required), `写入连接缺少工具 ${required}：${tools.join('、')}`)
        }
        assert.equal(tools.includes('create_visible_generation_task'), false, '未授权付费的连接不得看到付费生成工具')
        /*
         * 按域发现要经过真实 preload／IPC 才算数：域清单在渲染层从反射注册表派生，随宿主注册
         * 跨进程送到 MCP 服务。这里核对八个业务写域确实到达了外部契约，并且缺席的付费工具
         * 说得出缺哪一档——"清单里没有"不能被读成"应用没有这个能力"。
         */
        const contract = await call('describe_application_contract', {})
        const writableDomains = contract.data.domains.filter((domain) => domain.writable).map((domain) => domain.id).sort()
        assert.deepEqual(writableDomains, ['assets', 'camera_stage', 'canvas', 'generation', 'image_edit', 'image_mark', 'models', 'settings'], JSON.stringify(writableDomains))
        assert.equal(contract.data.domains.some((domain) => domain.id === 'assistant_runtime'), false, '助手内部运行目录不得出现在外部契约')
        assert.deepEqual(contract.data.access.hiddenTools.map((item) => item.name), ['create_visible_generation_task'], JSON.stringify(contract.data.access.hiddenTools))
        assert.equal(contract.data.access.hiddenTools[0].tier, 'paid')
        // 未授权付费时直接点名调用也必须被拒；拒绝发生在派发之前，不产生供应商请求。
        const paid = await client.callTool({ name: 'create_visible_generation_task', arguments: { operationId: require('node:crypto').randomUUID(), baselineIds: [require('node:crypto').randomUUID()], modelId: 'fixture', prompt: '不应发出', mediaType: 'image' } }).catch((error) => ({ isError: true, thrown: String(error) }))
        assert.equal(paid.isError, true, JSON.stringify(paid))

        // 跨工程目标：克隆夹具工程得到一个当前界面完全没有打开的后台工程。
        const backgroundProjectId = await page.evaluate(async (sourceId) => {
          const record = await window.henjiNative.storyboardProjects.getProjectRecord(sourceId)
          const id = crypto.randomUUID()
          const now = Date.now()
          await window.henjiNative.storyboardProjects.upsertProjectRecord({
            id, name: 'MCP后台工程', createdAt: now, updatedAt: now, nodeCount: record.nodeCount,
            nodesJson: record.nodesJson, edgesJson: record.edgesJson, viewportJson: record.viewportJson, historyJson: record.historyJson,
          })
          return id
        }, canvasFixtureProjectId)
        await assertStillOnSettings('写入前')

        const projectRef = { kind: 'canvas.project', id: backgroundProjectId }
        const project = await call('read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
        assert.equal(project.data.properties['canvas.project.name'], 'MCP后台工程')
        const args = { operationId: require('node:crypto').randomUUID(), baselineIds: [project.baselineId], summary: '后台跨域改名',
          changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': 'MCP后台已保存' } }] }
        const applied = await call('change_application_entities', args)
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        assert.equal(applied.verificationState, 'verified', JSON.stringify(applied))
        // 同身份重传只返回原事实，不重复修改。
        assert.deepEqual(await call('change_application_entities', args), applied)
        await assertStillOnSettings('写入后')

        const stored = await page.evaluate((id) => window.henjiNative.storyboardProjects.getProjectRecord(id), backgroundProjectId)
        assert.ok(stored, `正式画布存储缺少后台工程：${backgroundProjectId}`)
        assert.equal(stored.name, 'MCP后台已保存')
        const untouched = await page.evaluate((id) => window.henjiNative.storyboardProjects.getProjectRecord(id), canvasFixtureProjectId)
        assert.notEqual(untouched.name, 'MCP后台已保存', '跨工程写入串到了夹具工程')

        // 媒体读取只接受稳定业务引用；失败信息不得回传任何本地路径。
        const missing = await client.callTool({ name: 'read_application_media', arguments: { ref: { kind: 'generation.result', id: 'reality-not-persisted' } } })
        assert.equal(missing.isError, true)
        const missingText = missing.content.map((item) => item.text).join('')
        assert.ok(missingText.startsWith('MEDIA_NOT_PERSISTED'), missingText)
        assert.equal(/[A-Za-z]:\\|\//.test(missingText), false, `媒体失败信息泄漏了本地路径：${missingText}`)

        await page.reload(); await waitReady(page)
        const recovered = await call('get_application_operation', { operationId: args.operationId })
        assert.equal(recovered.executionState, 'completed', JSON.stringify(recovered))
        assert.equal(recovered.verificationState, 'verified', JSON.stringify(recovered))
        const afterReload = await page.evaluate((id) => window.henjiNative.storyboardProjects.getProjectRecord(id), backgroundProjectId)
        assert.equal(afterReload.name, 'MCP后台已保存')
      } finally {
        await client.close()
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }) })
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#general-mcp').scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
    },
  }]
}
module.exports = { createMcpScenes }
