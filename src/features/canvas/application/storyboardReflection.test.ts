import { describe, expect, it, vi } from 'vitest'

const commands = vi.hoisted(() => ({
  listStoryboardProjectSummaries: vi.fn(async () => [{
    id: 'story-1', name: '分镜一', createdAt: 1, updatedAt: 2, nodeCount: 1,
  }]),
  getStoryboardProjectRecord: vi.fn(async () => ({
    id: 'story-1',
    name: '分镜一',
    createdAt: 1,
    updatedAt: 2,
    nodeCount: 1,
    nodesJson: JSON.stringify([{ id: 'card-1', type: 'storyboard' }]),
    edgesJson: '[]',
    viewportJson: '{}',
    historyJson: '{}',
  })),
}))

vi.mock('@/commands/storyboardProjects', () => commands)

import { createStoryboardReflectionRegistrations, STORYBOARD_ENTITY_TYPES } from './storyboardReflection'

describe('storyboard reflection', () => {
  it('提供稳定项目与分镜卡关系并沿用项目 revision', async () => {
    const registrations = createStoryboardReflectionRegistrations()
    const project = registrations.find((item) => item.entity.id === STORYBOARD_ENTITY_TYPES.project)
    if (!project?.provider) throw new Error('STORYBOARD_PROVIDER_MISSING')
    const snapshot = await project.provider.readEntity(
      { kind: STORYBOARD_ENTITY_TYPES.project, id: 'story-1' },
      {},
    )
    expect(snapshot).toMatchObject({ revisions: { storyboard: 2 } })
    expect(snapshot?.properties['storyboard.project.card_refs']).toEqual([
      { kind: STORYBOARD_ENTITY_TYPES.card, id: 'story-1:card-1' },
    ])
  })
})
