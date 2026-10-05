// @vitest-environment jsdom
import { seedCanvasTestProject } from '@/tests/canvasProjectFixture'
import { describe, expect, it } from 'vitest'

import { createStoryboardReflectionRegistrations, STORYBOARD_ENTITY_TYPES } from './storyboardReflection'

describe('storyboard reflection', () => {
  it('分镜是画布文档的只读投影：项目即画布文档，卡片即节点，沿用文档 revision', async () => {
    seedCanvasTestProject({ id: 'story-1', name: '分镜一', nodes: [
      { id: 'card-1', type: 'storyboardGenNode', position: { x: 0, y: 0 }, data: {} },
    ], edges: [] })
    const registrations = createStoryboardReflectionRegistrations()
    const project = registrations.find((item) => item.entity.id === STORYBOARD_ENTITY_TYPES.project)
    if (!project?.provider) throw new Error('STORYBOARD_PROVIDER_MISSING')
    expect(project.entity.queryCapabilityIds).toEqual(['get_canvas_project'])
    const listed = await project.provider.listEntities({ limit: 10 })
    expect(listed.refs).toEqual([{ kind: STORYBOARD_ENTITY_TYPES.project, id: 'story-1', label: '分镜一' }])
    const snapshot = await project.provider.readEntity({ kind: STORYBOARD_ENTITY_TYPES.project, id: 'story-1' }, {})
    expect(snapshot.properties['storyboard.project.card_refs']).toEqual([
      { kind: STORYBOARD_ENTITY_TYPES.card, id: 'story-1:card-1' },
    ])
    expect(snapshot.properties['storyboard.project.name']).toBe('分镜一')
  })
})
