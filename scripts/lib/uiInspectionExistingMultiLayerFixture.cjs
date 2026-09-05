const fs = require('node:fs')
const path = require('node:path')

const DOCUMENT_PATH_ENV = 'HENJI_REAL_MULTI_LAYER_DOCUMENT_PATH'
const EXPECTED_LAYER_COUNT_ENV = 'HENJI_REAL_MULTI_LAYER_EXPECTED_LAYER_COUNT'

function readExistingMultiLayerFixtureSource(env) {
  const documentPath = String(env[DOCUMENT_PATH_ENV] ?? '').trim()
  if (!documentPath) return null
  if (!path.isAbsolute(documentPath)) {
    throw new Error(`${DOCUMENT_PATH_ENV} 必须是绝对路径`)
  }
  const expectedValue = String(env[EXPECTED_LAYER_COUNT_ENV] ?? '').trim()
  const expectedLayerCount = expectedValue ? Number(expectedValue) : null
  if (expectedLayerCount !== null
    && (!Number.isInteger(expectedLayerCount) || expectedLayerCount < 2)) {
    throw new Error(`${EXPECTED_LAYER_COUNT_ENV} 必须是大于等于 2 的整数`)
  }
  return { documentPath, expectedLayerCount }
}

function createExistingMultiLayerIsolatedCpuSceneDefinition(setup, env = process.env) {
  const source = readExistingMultiLayerFixtureSource(env)
  if (!source) return null
  return {
    id: 'canvas-existing-multi-layer-isolated-cpu-fallback',
    surface: '画布',
    name: '画布-已有多图层素材隔离CPU回退',
    writesUserData: true,
    forceGpuInitializationFailure: true,
    setup: (page, app, inspection) => setup(page, app, inspection, source),
  }
}

function detectImageMediaType(bytes) {
  if (bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  throw new Error('已有多图层夹具包含不支持的源资源格式')
}

function loadExistingMultiLayerSource(source) {
  const stored = JSON.parse(fs.readFileSync(source.documentPath, 'utf8'))
  const layers = stored?.document?.layers
  if (!Array.isArray(layers)
    || layers.length < 2
    || (source.expectedLayerCount !== null && layers.length !== source.expectedLayerCount)) {
    throw new Error('已有多图层夹具源不符合预期层数')
  }
  if (stored.revision !== 0 || stored.document?.revision !== 0) {
    throw new Error('已有多图层夹具源必须是 revision 0')
  }
  const storageRoot = path.dirname(path.dirname(source.documentPath))
  const resourcePaths = new Map()
  for (const layer of layers) {
    const resourceRef = layer?.type === 'raster'
      && layer.source?.kind === 'resource'
      && layer.source.resourceId
    const match = /^sha256:([a-f0-9]{64})$/.exec(String(resourceRef ?? ''))
    if (!match) throw new Error('已有多图层夹具只支持直接资源栅格层')
    const resourcePath = path.join(
      storageRoot,
      'resources',
      'objects',
      match[1].slice(0, 2),
      match[1],
    )
    if (!fs.statSync(resourcePath).isFile()) throw new Error('已有多图层夹具缺少源资源')
    resourcePaths.set(resourceRef, resourcePath)
  }
  return {
    geometry: stored.document.geometry,
    color: stored.document.color,
    layers,
    resources: [...resourcePaths].map(([resourceRef, filePath]) => {
      const bytes = fs.readFileSync(filePath)
      const mediaType = detectImageMediaType(bytes)
      return {
        resourceRef,
        dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}`,
      }
    }),
  }
}

async function seedExistingMultiLayerIsolatedFixture(page, context, source) {
  const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await context.settlePage(page, 350)
  const payload = loadExistingMultiLayerSource(source)
  return page.evaluate(async ({ targetProjectId, fixture }) => {
    const resources = new Map()
    for (const item of fixture.resources) {
      const managed = await window.henjiNative.imageEditorV3.ingestSource({
        requestId: `reality-existing-multi-layer-ingest-${crypto.randomUUID()}`,
        source: { kind: 'data-url', dataUrl: item.dataUrl },
      })
      resources.set(item.resourceRef, managed)
    }
    const documentId = `reality-existing-multi-layer-${crypto.randomUUID()}`
    const layers = fixture.layers.map((layer, index) => ({
      ...layer,
      name: `隔离图层 ${index + 1}`,
      source: {
        kind: 'resource',
        resourceId: resources.get(layer.source.resourceId).resource.resourceRef,
      },
    }))
    const editDocument = {
      version: 3,
      id: documentId,
      revision: 0,
      geometry: fixture.geometry,
      color: fixture.color,
      layers,
    }
    const resourceRefs = [...resources.values()].map((item) => item.resource.resourceRef)
    const saved = await window.henjiNative.imageEditorV3.saveDocument({
      requestId: `reality-existing-multi-layer-save-${crypto.randomUUID()}`,
      document: editDocument,
      expectedRevision: 0,
      history: null,
      resourceRefs,
      previewRef: null,
    })
    const first = resources.values().next().value
    const nodeId = '__ui_existing_multi_layer_isolated'
    const node = {
      id: nodeId,
      type: 'layerStackResultNode',
      position: { x: 720, y: 80 },
      width: 520,
      height: 300,
      measured: { width: 520, height: 300 },
      style: { width: 520, height: 300 },
      data: {
        displayName: '已有多图层素材隔离夹具',
        imageUrl: first.mediaUrl,
        previewImageUrl: first.mediaUrl,
        aspectRatio: `${fixture.geometry.width}:${fixture.geometry.height}`,
        resultKind: 'layer-stack',
        imageEditSession: {
          kind: 'image-edit-v3',
          sourceUrl: first.mediaUrl,
          documentRef: saved.documentRef,
          revision: saved.revision,
          previewRef: saved.previewRef,
        },
        isGenerating: false,
      },
    }
    await window.henjiNative.db.execute(
      `UPDATE storyboard_projects
       SET node_count = 1, nodes_json = ?, edges_json = '[]', viewport_json = ?, history_json = ?
       WHERE id = ?`,
      [JSON.stringify([node]), JSON.stringify({ x: 50, y: 120, zoom: 0.7 }),
        JSON.stringify({ past: [], future: [] }), targetProjectId]
    )
    return {
      projectId: targetProjectId,
      nodeId,
      expectedLayerCount: layers.length,
    }
  }, { targetProjectId: projectId, fixture: payload })
}

module.exports = {
  createExistingMultiLayerIsolatedCpuSceneDefinition,
  detectImageMediaType,
  readExistingMultiLayerFixtureSource,
  seedExistingMultiLayerIsolatedFixture,
}
