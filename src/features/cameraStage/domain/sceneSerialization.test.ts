import { describe, expect, it } from 'vitest'

import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import { sceneFromDocumentContent, sceneToDocumentContent } from './sceneSerialization'
import { createStateKeyframe } from './stateKeyframeTypes'

describe('镜头参考文档内容', () => {
  it('保存状态关键帧和全景环境，不写派生动画与已退役字段', () => {
    const camera = createCameraObject('摄像机', pickDefaultColor(0))
    const stateKeyframe = createStateKeyframe([camera], '关键帧 1', camera.id, 0)
    const content = sceneToDocumentContent({
      objects: [camera],
      activeCameraId: camera.id,
      sceneSettings: {
        ...createDefaultSceneSettings(),
        sky: { ...createDefaultSceneSettings().sky, environmentImageUrl: '/media/panorama.png' },
      },
      stateKeyframes: [stateKeyframe],
    })
    expect(content.stateKeyframes).toHaveLength(1)
    expect(content).not.toHaveProperty('schemaVersion')
    expect(content).not.toHaveProperty('editorMode')
    expect(content).not.toHaveProperty('shots')
    expect(content).not.toHaveProperty('animation')
    expect(sceneFromDocumentContent(JSON.parse(JSON.stringify(content))).sceneSettings.sky.environmentImageUrl)
      .toBe('/media/panorama.png')
  })
})
