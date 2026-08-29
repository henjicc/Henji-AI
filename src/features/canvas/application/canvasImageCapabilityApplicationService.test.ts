// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  getCanvasImageCapability,
  type CanvasImageCapabilityDefinition,
} from '@/features/canvas/capabilities'
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { useCanvasSpecialEditorController } from './specialEditorController'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import i18n from '@/i18n'

import { undoCanvasBatch, resetCanvasBatchStateForTests } from './canvasBatchService'
import { resetCanvasApplicationStateForTests } from './canvasApplicationService'
import { canvasEventBus } from './canvasServices'
import {
  createCanvasImageCapabilityExecutor,
  executeCanvasImageCapabilityForProject,
  resetCanvasImageCapabilityApplicationStateForTests,
} from './canvasImageCapabilityApplicationService'

const projectId = 'image-capability-project'
const sourceNodeId = 'source-image'

beforeAll(async () => {
  await loadRealModelsIntoRegistry()
})

function createSourceNode(): CanvasNode {
  return {
    id: sourceNodeId,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 80, y: 120 },
    measured: { width: 320, height: 260 },
    selected: true,
    data: { imageUrl: 'managed-source.png', aspectRatio: '1:1' },
  }
}

function createProject(node: CanvasNode): Project {
  return {
    id: projectId,
    name: '图片能力测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 1,
    coverPath: null,
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

function capabilityForNode(nodeType: CanvasNodeType): CanvasImageCapabilityDefinition {
  const base = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
  if (!base) throw new Error('缺少宫格切分能力测试基线')
  return {
    ...base,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: { kind: 'canvas-node', nodeType },
    },
  }
}

describe('画布图片能力应用服务', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    resetCanvasApplicationStateForTests()
    resetCanvasBatchStateForTests()
    resetCanvasImageCapabilityApplicationStateForTests()
    useCanvasSpecialEditorController.getState().discard()
    const sourceNode = createSourceNode()
    const project = createProject(sourceNode)
    useCanvasStore.getState().setCanvasData([sourceNode], [], { past: [], future: [] })
    useCanvasStore.setState({
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasViewportSize: { width: 1_200, height: 800 },
      selectedNodeId: sourceNodeId,
    })
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  it('本地工具能力只打开现有对话框，不创建重复节点', async () => {
    const opened: Array<{ nodeId: string; toolType: string }> = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/open', (payload) => opened.push(payload))
    const execute = createCanvasImageCapabilityExecutor()

    await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)

    expect(opened).toEqual([{ nodeId: sourceNodeId, toolType: 'split-storyboard' }])
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    unsubscribe()
  })

  it('助手项目入口在项目不匹配时零写入拒绝', async () => {
    await expect(executeCanvasImageCapabilityForProject({
      projectId: 'other-project',
      sourceNodeId,
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval,
    })).rejects.toThrow('当前画布项目与命令目标不一致')
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('助手项目入口成功返回项目、节点、连线和事务撤销引用', async () => {
    const result = await executeCanvasImageCapabilityForProject({
      projectId,
      sourceNodeId,
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval,
    })

    expect(result).toMatchObject({
      projectId,
      kind: 'canvas-node',
      sourceNodeId,
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval,
    })
    expect(result.nodeId).toBeTruthy()
    expect(result.edgeId).toBeTruthy()
    expect(result.undoRef).toBeTruthy()
  })

  it('助手项目入口在本地工具执行前拒绝，不打开界面也不写入', async () => {
    const opened: Array<{ nodeId: string; toolType: string }> = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/open', (payload) => opened.push(payload))

    await expect(executeCanvasImageCapabilityForProject({
      projectId,
      sourceNodeId,
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.gridSplit,
    })).rejects.toThrow('本地工具界面')

    expect(opened).toEqual([])
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    unsubscribe()
  })

  it('创建型能力原子完成相邻放置、连线、选中与单次撤销', async () => {
    const capability = capabilityForNode(CANVAS_NODE_TYPES.imageEdit)
    const execute = createCanvasImageCapabilityExecutor({
      getExecutableCapabilities: () => [capability],
    })

    const first = execute(sourceNodeId, capability.id)
    const duplicatedClick = execute(sourceNodeId, capability.id)
    expect(duplicatedClick).toBe(first)
    const result = await first

    expect(result).toMatchObject({ kind: 'canvas-node', sourceNodeId, capabilityId: capability.id })
    if (result.kind !== 'canvas-node') throw new Error('预期创建画布节点')
    const canvas = useCanvasStore.getState()
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes.find((node) => node.id === result.nodeId)?.position.x).toBeGreaterThan(400)
    expect(canvas.edges).toEqual([
      expect.objectContaining({
        id: result.edgeId,
        source: sourceNodeId,
        target: result.nodeId,
        sourceHandle: 'source',
        targetHandle: 'param:__image',
      }),
    ])
    expect(canvas.selectedNodeId).toBe(result.nodeId)
    expect(canvas.nodes.find((node) => node.id === result.nodeId)?.selected).toBe(true)
    expect(canvas.history.past).toHaveLength(1)
    expect(useProjectStore.getState().saveCurrentProject).toHaveBeenCalledTimes(1)

    expect(undoCanvasBatch(projectId, result.undoRef)).toMatchObject({ status: 'undone' })
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    expect(useCanvasStore.getState().selectedNodeId).toBe(sourceNodeId)
  })

  it('连线不兼容时回滚创建节点与历史，不留孤立节点', async () => {
    const incompatible = capabilityForNode(CANVAS_NODE_TYPES.intSource)
    const execute = createCanvasImageCapabilityExecutor({
      getExecutableCapabilities: () => [incompatible],
    })

    await expect(execute(sourceNodeId, incompatible.id)).rejects.toThrow('节点端口类型不兼容')
    expect(useCanvasStore.getState().nodes).toEqual([expect.objectContaining({ id: sourceNodeId })])
    expect(useCanvasStore.getState().edges).toEqual([])
    expect(useCanvasStore.getState().history).toEqual({ past: [], future: [] })
  })

  it('全景能力通过受控节点目录创建并连接专用生成节点', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.panorama)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.panorama' })
    const panoramaNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.panoramaGen,
    )
    expect(panoramaNode?.data).toMatchObject({
      displayName: '720°全景',
      capabilityId: 'image.panorama',
      promptTemplateVersion: 'panorama-equirectangular-text-v1',
      fixedSemanticParams: { aspectRatio: '2:1', outputCount: 1 },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: panoramaNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
  })

  it('打光能力创建专用节点、保留契约并连接源图端口', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.relight)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.relight' })
    const relightNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.relightGen,
    )
    expect(relightNode?.data).toMatchObject({
      displayName: '图片打光',
      capabilityId: 'image.relight',
      promptTemplateVersion: 'relight-manual-iclight-v1',
      relightSettings: {
        relightContractVersion: 1,
        lightingMode: 'manual',
      },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: relightNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
  })

  it.each([
    [CANVAS_IMAGE_CAPABILITY_IDS.presetRelight, 'fal-image-apps-v2-relighting', '预设重打光', 'hidden', undefined],
    [CANVAS_IMAGE_CAPABILITY_IDS.lowLightEnhancement, 'fal-control-light', '暗光增强', 'hidden', undefined],
    [CANVAS_IMAGE_CAPABILITY_IDS.outpaint, 'fal-image-apps-v2-outpaint', '智能扩图', 'optional', 500],
    [CANVAS_IMAGE_CAPABILITY_IDS.productPhotography, 'fal-image-apps-v2-product-photography', '商品摄影', 'hidden', undefined],
    [CANVAS_IMAGE_CAPABILITY_IDS.photoRestoration, 'fal-image-apps-v2-photo-restoration', '照片修复', 'hidden', undefined],
    [CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval, 'fal-pixelcut-background-removal', '背景移除', 'hidden', undefined],
  ] as const)('%s 创建固定模型标准工具节点', async (
    capabilityId,
    modelId,
    displayName,
    promptMode,
    promptMaxCharacters,
  ) => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, capabilityId)
    expect(result.kind).toBe('canvas-node')
    if (result.kind !== 'canvas-node') throw new Error('图片工具必须创建画布节点')
    const toolNode = useCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)
    expect(toolNode).toMatchObject({
      type: CANVAS_NODE_TYPES.imageEdit,
      data: {
        displayName,
        modelId,
        params: {},
        generationUi: {
          promptMode,
          modelMode: 'locked',
          excludeParamIds: ['image'],
          ...(promptMaxCharacters ? { promptMaxCharacters } : {}),
        },
      },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: result.nodeId,
        targetHandle: 'param:__image',
      }),
    ])
  })

  it('固定工具标题随当前界面语言创建，不把中文名称写死到英文项目', async () => {
    await i18n.changeLanguage('en-US')
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval)
    if (result.kind !== 'canvas-node') throw new Error('图片工具必须创建画布节点')

    expect(useCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)?.data.displayName)
      .toBe('Background Removal')
  })

  it('多角度能力创建默认四视图专用节点并连接唯一源图', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.multiAngle)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.multi-angle' })
    const multiAngleNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.multiAngleGen,
    )
    expect(multiAngleNode?.data).toMatchObject({
      displayName: '多角度视图',
      capabilityId: 'image.multi-angle',
      modelId: 'fal-qwen-image-edit-2509-multiple-angles',
      prompt: '',
      params: {},
      multiAngleConfig: {
        version: 1,
        controlProfile: 'continuous-v1',
        concurrency: 2,
      },
    })
    expect((multiAngleNode?.data as DynamicValueMap).multiAngleConfig.views).toHaveLength(4)
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: multiAngleNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
  })

  it('九宫格能力复用现有分镜节点并原子写入固定 3×3 预设', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.nineGrid)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.nine-grid' })
    const storyboardNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.storyboardGen,
    )
    expect(storyboardNode?.data).toMatchObject({
      displayName: '九宫格',
      capabilityId: 'image.nine-grid',
      storyboardPreset: 'nine-grid-v1',
      promptTemplateVersion: 'nine-grid-storyboard-v1',
      gridRows: 3,
      gridCols: 3,
    })
    expect((storyboardNode?.data as DynamicValueMap).frames).toHaveLength(9)
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: storyboardNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
    expect(useCanvasStore.getState().history.past).toHaveLength(1)
  })

  it('高清能力创建受控 Topaz 节点并连接唯一源图', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.upscale)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.upscale' })
    const upscaleNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.upscaleGen,
    )
    expect(upscaleNode?.data).toMatchObject({
      displayName: '高清放大',
      capabilityId: 'image.upscale',
      modelId: 'fal-ai-topaz-image-upscale',
      params: {
        falTopazUpscaleFactor: 2,
        falTopazFaceEnhancement: false,
      },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: upscaleNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
  })

  it('人像质感能力创建版本化保守编辑节点并连接唯一源图', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.portrait-texture' })
    const portraitNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.portraitTextureGen,
    )
    expect(portraitNode?.data).toMatchObject({
      displayName: '人像质感',
      capabilityId: 'image.portrait-texture',
      modelId: 'fal-ai-gpt-image-2',
      promptTemplateVersion: 'portrait-texture-gpt-image-2-v1',
      portraitTextureSettings: {
        portraitTextureContractVersion: 1,
        preset: 'natural-detail',
        strength: 'subtle',
      },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: portraitNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
  })

  it('元素编辑能力创建相邻节点并自动打开唯一蒙版编辑器', async () => {
    const execute = createCanvasImageCapabilityExecutor()
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.elementEdit)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.element-edit' })
    const elementNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.elementEditGen,
    )
    expect(elementNode?.data).toMatchObject({
      displayName: '元素编辑',
      capabilityId: 'image.element-edit',
      modelId: 'apimart-gpt-image-2',
      promptTemplateVersion: 'element-edit-mask-v1',
      fixedSemanticParams: {
        referenceImageCount: 1,
        outputCount: 1,
        quality: 'medium',
        maskDocumentVersion: 1,
        maskEncoding: 'alpha',
        maskPaintMeaning: 'transparent-edit',
      },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({
        source: sourceNodeId,
        target: elementNode?.id,
        targetHandle: 'param:__image',
      }),
    ])
    expect(useCanvasSpecialEditorController.getState().session).toMatchObject({
      projectId,
      nodeId: elementNode?.id,
      editorKey: 'mask',
      isDirty: false,
    })
  })

  it('图层拆分能力以原厂 Seedream 固定模式创建专用节点并连接单张源图', async () => {
    const capability = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation)
    if (!capability) throw new Error('缺少图层拆分能力')
    const execute = createCanvasImageCapabilityExecutor({ getExecutableCapabilities: () => [capability] })
    const result = await execute(sourceNodeId, CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation)
    expect(result).toMatchObject({ kind: 'canvas-node', capabilityId: 'image.layer-separation' })
    const node = useCanvasStore.getState().nodes.find((item) => item.type === CANVAS_NODE_TYPES.layerSeparationGen)
    expect(node?.data).toMatchObject({
      displayName: '图层拆分',
      capabilityId: 'image.layer-separation',
      modelId: 'volcengine-seedream-5.0-pro',
      params: { volcengineSeedream50ProMode: 'layer-decomposition' },
      fixedSemanticParams: { layerStackContractVersion: 1 },
    })
    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({ source: sourceNodeId, target: node?.id, targetHandle: 'param:__image' }),
    ])
  })
})
