import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AgentIntentRouter } from './router'

function snapshot(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-camera-regression',
    revision: 1,
    scopeRevisions: { navigation: 1, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

describe('AgentIntentRouter 3D fallback', () => {
  it('Router provider 失败时用户原话仍回退到可创建工程的完整三维图', async () => {
    const router = new AgentIntentRouter(async () => { throw new Error('PROVIDER_ERROR') })
    const result = await router.route(
      'run-camera-provider-fallback',
      '在 3D 镜头参考里边，新建一个叫测试7788的项目，然后在新的场景里边放一个紫色立方体，然后放一个红色圆柱体，然后做一个大概 60 帧的动画吧，然后一个是摄像机围绕着它旋转，然后，两个物体是漂浮着的，上下移动的',
      snapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'camera_stage', source: 'deterministic' })
    expect(result.taskGraph?.facets.filter((facet) => facet.dependsOn.length === 0)
      .map((facet) => facet.facetId)).toEqual(['camera_project'])
    expect(result.taskGraph?.facets.find((facet) => facet.facetId === 'camera_project')
      ?.requiredEffects[0]).toMatchObject({ effect: 'create', entityTypes: ['camera_stage.project'] })
    expect(result.taskGraph?.facets.find((facet) => facet.facetId === 'camera_scene')
      ?.requiredEffects).toEqual(expect.arrayContaining([
        expect.objectContaining({ effect: 'execute', minimumCount: 2 }),
        expect.objectContaining({ effect: 'update', minimumCount: 2 }),
      ]))
  })
})
