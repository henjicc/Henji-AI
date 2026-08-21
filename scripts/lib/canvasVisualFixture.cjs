'use strict'

const SELECTOR_TYPES = [
  'imageModelSelectorNode',
  'videoModelSelectorNode',
  'audioModelSelectorNode',
]

const DEFAULT_MODEL_IDS = {
  imageModelSelectorNode: 'kie-nano-banana-2',
  videoModelSelectorNode: 'kie-kling-3.0',
  audioModelSelectorNode: 'ppio-minimax-speech',
}

const SELECTOR_DISPLAY_NAMES = {
  imageModelSelectorNode: '图片模型',
  videoModelSelectorNode: '视频模型',
  audioModelSelectorNode: '音频模型',
}

function buildSyntheticVisualSourceNodes() {
  return SELECTOR_TYPES.map((type, index) => {
    const isExpanded = type !== 'imageModelSelectorNode'
    const width = isExpanded ? 320 : 240
    const height = isExpanded ? 380 : 44
    return {
      id: `__visual_source_${type}`,
      type,
      position: { x: index * 440, y: isExpanded ? 0 : 300 },
      data: {
        displayName: SELECTOR_DISPLAY_NAMES[type],
        modelId: DEFAULT_MODEL_IDS[type],
        isExpanded,
      },
      width,
      height,
      measured: { width, height },
      style: { width, height },
      selected: false,
    }
  })
}

/**
 * 优先复用指定真实项目；不存在时创建可清理的最小模型选择器基准项目。
 * 返回的临时源项目名带 FIXTURE_PREFIX，由调用方统一清理。
 */
async function ensureVisualSourceProject(page, requestedName, fixturePrefix) {
  const existing = await page.evaluate(async (projectName) => {
    const rows = await window.henjiNative.db.select(
      'SELECT id, name FROM storyboard_projects WHERE name = ? ORDER BY updated_at DESC LIMIT 1',
      [projectName]
    )
    return rows.length ? rows[0] : null
  }, requestedName)
  if (existing) {
    return { sourceProject: requestedName, created: false, projectId: existing.id }
  }

  const sourceProject = `${fixturePrefix}visual_source_${Date.now()}`
  const nodes = buildSyntheticVisualSourceNodes()
  const projectId = await page.evaluate(async (payload) => {
    const id = `visual-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    await window.henjiNative.db.execute(
      `INSERT INTO storyboard_projects
       (id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payload.name,
        now,
        now,
        payload.nodes.length,
        JSON.stringify(payload.nodes),
        '[]',
        JSON.stringify({ x: 120, y: 120, zoom: 0.8 }),
        JSON.stringify({ past: [], future: [], imagePool: [] }),
      ]
    )
    return id
  }, { name: sourceProject, nodes })

  return { sourceProject, requestedSourceProject: requestedName, created: true, projectId }
}

const MISSING_TYPE_FIXTURES = {
  universalUploadNode: { data: { displayName: '上传', lockedMediaKind: null, uploadError: null }, width: 240, height: 240 },
  textProcessingNode: {
    data: {
      displayName: '文本处理',
      prompt: '总结输入内容',
      systemPromptTemplateId: 'text-processing-image-optimizer',
      mediaInputs: {},
      providerId: 'ppio',
      modelId: 'deepseek/deepseek-v4-flash',
      lastOutput: '',
    },
    width: 360,
    height: 190,
  },
  groupNode: { data: { displayName: '组', label: '组' }, width: 360, height: 240 },
  exportAudioNode: { data: { displayName: '音频结果', audioUrl: null, durationSec: null } },
  intSourceNode: { data: { displayName: '整数', value: 0 }, width: 180, height: 64 },
  floatSourceNode: { data: { displayName: '小数', value: 0.5 }, width: 180, height: 64 },
  stringSourceNode: { data: { displayName: '文本', value: '测试' }, width: 240, height: 96 },
  booleanSourceNode: { data: { displayName: '布尔', value: false }, width: 180, height: 64 },
  audioModelSelectorNode: {
    data: { displayName: '音频模型', modelId: 'ppio-minimax-speech', isExpanded: false },
    width: 240,
    height: 44,
  },
}

/**
 * 仅改本次临时 fixture：补齐三种模型选择器，并统一切到折叠或展开态。
 * 用于 2.1 同时验证三种媒体类型，不接触真实项目。
 */
async function prepareModelSelectorFixture(page, fixture, state) {
  if (!['collapsed', 'expanded'].includes(state)) return fixture
  const result = await page.evaluate(async ({ projectId, selectorTypes, defaultModelIds, expanded }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [projectId]
    )
    if (!rows.length) throw new Error(`找不到临时项目：${projectId}`)
    const nodes = JSON.parse(rows[0].nodes_json)
    const template = nodes.find((node) => selectorTypes.includes(node.type))
    if (!template) throw new Error('源项目中没有可用于补齐模型选择器的模板节点')
    for (const [index, type] of selectorTypes.entries()) {
      let matchingNodes = nodes.filter((candidate) => candidate.type === type)
      if (!matchingNodes.length) {
        const node = {
          ...template,
          id: `__visual_${type}`,
          type,
          parentId: undefined,
          extent: undefined,
          position: {
            x: (template.position?.x ?? 0) + 600 + index * 80,
            y: (template.position?.y ?? 0) + 120 + index * 80,
          },
          data: {
            ...template.data,
            displayName: type,
            modelId: defaultModelIds[type],
          },
          selected: false,
        }
        nodes.push(node)
        matchingNodes = [node]
      }
      for (const node of matchingNodes) {
        const width = expanded ? 320 : 240
        const height = expanded ? 380 : 44
        node.data = { ...node.data, isExpanded: expanded }
        node.width = width
        node.height = height
        node.measured = { width, height }
        node.style = { ...(node.style ?? {}), width, height }
      }
    }

    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET node_count = ?, nodes_json = ? WHERE id = ?',
      [nodes.length, JSON.stringify(nodes), projectId]
    )
    return { nodeCount: nodes.length }
  }, {
    projectId: fixture.projectId,
    selectorTypes: SELECTOR_TYPES,
    defaultModelIds: DEFAULT_MODEL_IDS,
    expanded: state === 'expanded',
  })
  return { ...fixture, nodeCount: result.nodeCount, selectorState: state }
}

/** 补齐源项目缺少的内置节点类型，用于真正执行全注册表几何与裁剪检查。 */
async function prepareFullTypeFixture(page, fixture, enabled) {
  if (!enabled) return fixture
  const result = await page.evaluate(async ({ projectId, fixtures }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [projectId]
    )
    if (!rows.length) throw new Error(`找不到临时项目：${projectId}`)
    const nodes = JSON.parse(rows[0].nodes_json)
    const anchor = nodes.find((node) => node.type === 'imageModelSelectorNode') ?? nodes[0]
    let added = 0
    for (const [type, fixtureConfig] of Object.entries(fixtures)) {
      if (nodes.some((node) => node.type === type)) continue
      const width = fixtureConfig.width
      const height = fixtureConfig.height
      const column = added % 3
      const row = Math.floor(added / 3)
      nodes.push({
        id: `__visual_${type}`,
        type,
        position: {
          x: (anchor.position?.x ?? 0) + 420 + column * 420,
          y: (anchor.position?.y ?? 0) + 520 + row * 300,
        },
        data: fixtureConfig.data,
        selected: false,
        ...(width && height ? {
          width,
          height,
          measured: { width, height },
          style: { width, height },
        } : {}),
      })
      added += 1
    }
    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET node_count = ?, nodes_json = ? WHERE id = ?',
      [nodes.length, JSON.stringify(nodes), projectId]
    )
    return { nodeCount: nodes.length }
  }, { projectId: fixture.projectId, fixtures: MISSING_TYPE_FIXTURES })
  return { ...fixture, nodeCount: result.nodeCount, fullTypeFixture: true }
}

module.exports = {
  buildSyntheticVisualSourceNodes,
  ensureVisualSourceProject,
  prepareFullTypeFixture,
  prepareModelSelectorFixture,
}
