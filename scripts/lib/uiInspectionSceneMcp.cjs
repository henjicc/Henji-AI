/* eslint-disable @typescript-eslint/no-var-requires, no-console -- 正式 Electron CommonJS 场景与诊断输出。 */
const assert = require('node:assert/strict')
const { Client } = require('@modelcontextprotocol/client')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/client')
const { parseMcpConnectionInstructions } = require('./uiInspectionMcpClient.cjs')

// 同一连接可发现完整的读写工具目录。
const REQUIRED_READ_TOOLS = ['describe_application_contract', 'describe_application_entities', 'list_application_entities', 'read_application_entity', 'read_application_media']
const WRITE_TOOLS = ['change_application_entities', 'create_visible_generation_task', 'cancel_generation_task',
  'render_camera_stage_output', 'cancel_camera_stage_render_task', 'add_generation_result_to_canvas',
  'get_application_operation', 'retry_application_operation_save']

function createMcpScenes({ setupSettings, canvasFixtureProjectId }) {
  const setSwitch = async (page, index, value) => {
    const control = page.locator('#assistant-mcp').getByRole('switch').nth(index)
    if ((await control.getAttribute('aria-checked')) !== String(value)) await control.click()
    await page.waitForFunction(({ index, value }) => document.querySelectorAll('#assistant-mcp [role="switch"]')[index]?.getAttribute('aria-checked') === String(value), { index, value })
  }
  const closeMcp = (page) => page.evaluate(async () => {
    const state = await window.henjiNative.mcp.status()
    for (const connection of state.connections ?? []) {
      await window.henjiNative.mcp.revoke({ id: connection.id })
    }
    await window.henjiNative.mcp.configure({ enabled: false, port: state.port })
  })
  const waitReady = async (page) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await page.evaluate(async () => (await window.henjiNative.mcp.status()).ready)) return
      await page.waitForTimeout(100)
    }
    throw new Error('应用宿主未在限定时间内就绪')
  }
  const assertTools = (names) => {
    for (const required of REQUIRED_READ_TOOLS) assert.ok(names.includes(required), `连接缺少读取工具 ${required}：${names.join('、')}`)
    for (const write of WRITE_TOOLS) assert.ok(names.includes(write), `连接缺少写入工具 ${write}`)
  }
  return [{ id: 'mcp-read-lifecycle', surface: '设置', name: '外部连接-工具发现与重载', writesUserData: true,
    setup: async (page) => {
      /*
       * 同名已存在就直接复用，不能无条件创建。
       *
       * 多个窗口尺寸共用同一份隔离资料目录，setup 每个尺寸都会跑一遍；而这个只读夹具
       * 从头到尾没人删——场景正文操作的是它自己经 MCP 新建再删掉的另一个集合。于是
       * 第二个尺寸必然撞上「名称已被占用」的正式拒绝，整场失败。产品的拒绝文案本身就写着
       * 「先用列表能力取到同名素材库的稳定引用直接使用它」，这里照做。
       */
      await page.evaluate(async () => {
        const libraries = await window.henjiNative.assetLibrary.listLibraries()
        if (libraries.some((item) => item.name === 'MCP隔离验收素材库')) return
        await window.henjiNative.assetLibrary.createLibrary('MCP隔离验收素材库')
      })
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const initial = await page.evaluate(() => window.henjiNative.mcp.status())
      const section = page.locator('#assistant-mcp')
      if (!initial.enabled) await section.getByRole('switch').first().click()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: /设置|Settings/ }).waitFor({ state: 'hidden' })
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await section.getByPlaceholder('例如：Codex').fill('协议验收客户端')
      await section.getByRole('button', { name: '创建授权' }).click()
      await section.getByRole('button', { name: '复制连接配置' }).waitFor()
      await waitReady(page)
      const connection = await page.evaluate(async () => {
        const status = await window.henjiNative.mcp.status()
        const identity = status.connections.find((item) => item.name === '协议验收客户端')
        return { id: identity.id, config: await window.henjiNative.mcp.connectionConfig({ id: identity.id }) }
      })
      connection.config = parseMcpConnectionInstructions(connection.config)
      const connect = async () => {
        const client = new Client({ name: 'Henji Reality', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
        await client.connect(new StreamableHTTPClientTransport(new URL(connection.config.url), { requestInit: { headers: connection.config.headers } }))
        return client
      }
      let client = await connect()
      try {
        assertTools((await client.listTools()).tools.map((tool) => tool.name))
        const described = await client.callTool({ name: 'describe_application_entities', arguments: { entityTypes: ['settings.registry', 'asset.library', 'canvas.document', 'generation.model'] } })
        assert.equal(described.isError, false, JSON.stringify(described))
        for (const entityType of ['settings.registry', 'asset.library', 'canvas.document', 'generation.model']) {
          console.log(`[MCP Reality] 读取 ${entityType}`)
          const listed = await client.callTool({ name: 'list_application_entities', arguments: { entityType, limit: 5 } })
          assert.equal(listed.isError, false, JSON.stringify(listed))
          const refs = listed.structuredContent.data.refs
          assert.ok(refs.length > 0, `${entityType} 必须存在真实实例`)
          const ref = entityType === 'canvas.document' ? refs.find((item) => item.id === canvasFixtureProjectId) : refs[0]
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
        assertTools((await client.listTools()).tools.map((tool) => tool.name))
        const after = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_contrast'] } })
        assert.equal(after.isError, false)
        await client.close()
        console.log('[MCP Reality] 同页面关闭再开启')
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }); await window.henjiNative.mcp.configure({ enabled: true, port: state.port }) })
        client = await connect()
        assertTools((await client.listTools()).tools.map((tool) => tool.name))
        await page.evaluate((id) => window.henjiNative.mcp.revoke({ id }), connection.id)
        const denied = await fetch(connection.config.url, { headers: connection.config.headers })
        assert.equal(denied.status, 401)
      } finally {
        await client.close()
        await closeMcp(page)
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#assistant-mcp').scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
    },
  }, { id: 'mcp-write-recovery', surface: '设置', name: '外部连接-受控写入与事实保留', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const section = page.locator('#assistant-mcp')
      await setSwitch(page, 0, true)
      await section.getByPlaceholder('例如：Codex').fill('受控写入验收')
      await section.getByRole('button', { name: '创建授权' }).click()
      await waitReady(page)
      const config = parseMcpConnectionInstructions(await page.evaluate(async () => {
        const state = await window.henjiNative.mcp.status()
        const connection = state.connections.find((item) => item.name === '受控写入验收')
        return await window.henjiNative.mcp.connectionConfig({ id: connection.id })
      }))
      const client = new Client({ name: 'Henji write Reality', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
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
        const settings = await read(settingsRef, ['interface.theme_contrast'])
        const theme = settings.data.properties['interface.theme_contrast'] === 'soft' ? 'strong' : 'soft'
        await change([{ kind: 'set_properties', entityType: settingsRef.kind, target: settingsRef, properties: { 'interface.theme_contrast': theme } }], [settings])
        assert.equal((await read(settingsRef, ['interface.theme_contrast'])).data.properties['interface.theme_contrast'], theme)
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
        // 3.4 起画布是通用文档：改名走 documents.document.name（canvas.document.name 只读）
        const projectRef = { kind: 'documents.document', id: canvasFixtureProjectId }
        const project = await read(projectRef, ['documents.document.name'])
        await change([{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'documents.document.name': 'MCP已保存画布' } }], [project])
        assert.equal((await read(projectRef, ['documents.document.name'])).data.properties['documents.document.name'], 'MCP已保存画布')
        // 直接检查正式存储，不把协议 ok 当作持久化证据。
        const stored = await page.evaluate(async ({ projectId }) => ({
          libraries: await window.henjiNative.assetLibrary.listLibraries(),
          settings: JSON.parse(localStorage.getItem('settings-storage')),
          hiddenModels: localStorage.getItem('hidden_models'),
          project: await window.henjiNative.testFixtures.readCanvas(projectId),
        }), { libraryId: libraryRef.id, projectId: canvasFixtureProjectId })
        const storedLibrary = stored.libraries.find((item) => String(item.id) === String(libraryRef.id))
        assert.ok(storedLibrary, `正式素材库缺少结果引用：${JSON.stringify({ libraryRef, libraries: stored.libraries })}`)
        assert.equal(storedLibrary.name, 'MCP已改名集合')
        assert.equal(stored.settings.state.themeSelection.contrast, theme)
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
        const stale = await client.callTool({ name: 'change_application_entities', arguments: { operationId: require('node:crypto').randomUUID(), baselineIds: [project.baselineId], summary: '过期基线拒绝', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'documents.document.name': '不能写入' } }] } })
        assert.equal(stale.isError, true)
        // 撤回本场景改过的全局设置：层级对比与模型隐藏是应用级状态，不还原会漏到后面的场景
        // （“设置-主题外观”断言默认层级对比为“标准”，曾因此在全量顺序跑时失败，5.8）。
        await change([{ kind: 'set_properties', entityType: settingsRef.kind, target: settingsRef,
          properties: { 'interface.theme_contrast': settings.data.properties['interface.theme_contrast'] } }], [await read(settingsRef, ['interface.theme_contrast'])])
        await change([{ kind: 'set_properties', entityType: modelRef.kind, target: modelRef,
          properties: { 'generation.model.hidden': !hidden } }], [await read(modelRef, ['generation.model.hidden', 'generation.model.provider_id'])])
      } finally {
        await client.close()
        await closeMcp(page)
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#assistant-mcp').scrollIntoViewIfNeeded()
    },
  }, { id: 'mcp-background-crossdomain', surface: '设置', name: '外部连接-后台任务与跨域保存', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const section = page.locator('#assistant-mcp')
      await setSwitch(page, 0, true)
      await section.getByPlaceholder('例如：Codex').fill('后台跨域验收')
      await section.getByRole('button', { name: '创建授权' }).click()
      await waitReady(page)
      const identity = await page.evaluate(async () => {
        const state = await window.henjiNative.mcp.status()
        const connection = state.connections.find((item) => item.name === '后台跨域验收')
        return { config: await window.henjiNative.mcp.connectionConfig({ id: connection.id }) }
      })
      identity.config = parseMcpConnectionInstructions(identity.config)
      const client = new Client({ name: 'Henji background Reality', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
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
        const contract = await call('describe_application_contract', {})
        const writableDomains = contract.data.domains.filter((domain) => domain.writable).map((domain) => domain.id).sort()
        for (const domain of ['assets', 'camera_stage', 'canvas', 'generation', 'image_edit', 'models', 'settings', 'memory']) {
          assert.ok(writableDomains.includes(domain), `缺少已声明写域 ${domain}：${JSON.stringify(writableDomains)}`)
        }
        assert.equal(contract.data.domains.some((domain) => domain.id === 'assistant_runtime'), false, '助手内部运行目录不得出现在外部契约')
        for (const name of ['create_visible_generation_task', 'submit_canvas_node_generation']) {
          assert.ok(tools.includes(name), `连接缺少生成工具 ${name}`)
        }

        // 跨工程目标：克隆夹具工程得到一个当前界面完全没有打开的后台工程。
        const backgroundProjectId = await page.evaluate(async (sourceId) => {
          const record = await window.henjiNative.testFixtures.readCanvas(sourceId)
          const created = await window.henjiNative.testFixtures.createCanvas({
            name: 'MCP后台工程', nodes: record.nodes, edges: record.edges, ...(record.viewport ? { viewport: record.viewport } : {}), replace: true,
          })
          return created.id
        }, canvasFixtureProjectId)
        await assertStillOnSettings('写入前')

        const projectRef = { kind: 'documents.document', id: backgroundProjectId }
        const project = await call('read_application_entity', { ref: projectRef, propertyIds: ['documents.document.name'] })
        assert.equal(project.data.properties['documents.document.name'], 'MCP后台工程')
        const args = { operationId: require('node:crypto').randomUUID(), baselineIds: [project.baselineId], summary: '后台跨域改名',
          changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'documents.document.name': 'MCP后台已保存' } }] }
        const applied = await call('change_application_entities', args)
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        assert.equal(applied.verificationState, 'verified', JSON.stringify(applied))
        // 同身份重传只返回原事实，不重复修改。
        assert.deepEqual(await call('change_application_entities', args), applied)
        await assertStillOnSettings('写入后')

        const stored = await page.evaluate((id) => window.henjiNative.testFixtures.readCanvas(id), backgroundProjectId)
        assert.ok(stored, `正式画布存储缺少后台工程：${backgroundProjectId}`)
        assert.equal(stored.name, 'MCP后台已保存')
        const untouched = await page.evaluate((id) => window.henjiNative.testFixtures.readCanvas(id), canvasFixtureProjectId)
        assert.notEqual(untouched.name, 'MCP后台已保存', '跨工程写入串到了夹具工程')

        // 媒体读取只接受稳定业务引用；失败信息不得回传任何本地路径。
        const missing = await client.callTool({ name: 'read_application_media', arguments: { ref: { kind: 'generation.result', id: 'reality-not-persisted' } } })
        assert.equal(missing.isError, true)
        const missingText = missing.content.map((item) => item.text).join('')
        assert.ok(missingText.includes('ENTITY_NOT_FOUND'), missingText)
        assert.equal(/[A-Za-z]:\\|\//.test(missingText), false, `媒体失败信息泄漏了本地路径：${missingText}`)

        await page.reload(); await waitReady(page)
        const recovered = await call('get_application_operation', { operationId: args.operationId })
        assert.equal(recovered.executionState, 'completed', JSON.stringify(recovered))
        assert.equal(recovered.verificationState, 'verified', JSON.stringify(recovered))
        const afterReload = await page.evaluate((id) => window.henjiNative.testFixtures.readCanvas(id), backgroundProjectId)
        assert.equal(afterReload.name, 'MCP后台已保存')
      } finally {
        await client.close()
        await closeMcp(page)
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#assistant-mcp').scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
    },
  }]
}
module.exports = { createMcpScenes }
