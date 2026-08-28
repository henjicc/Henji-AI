/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  getExecutableCanvasImageCapabilitiesForSourceNode,
  getCanvasImageCapability,
  getRegisteredCanvasImageCapabilities,
} from '@/features/canvas/capabilities'
import { CANVAS_NODE_TYPES, NODE_TOOL_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { getNodeToolPlugins } from '@/features/canvas/tools'

import {
  CanvasImageCapabilityActions,
} from './CanvasImageCapabilityActions'
import {
  excludeClaimedLocalTools,
  partitionCanvasImageCapabilities,
} from './canvasImageCapabilityLayout'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

afterEach(() => cleanup())

describe('画布图片能力工具条入口', () => {
  it('只有一项能力时直接显示，不产生多余的更多入口', () => {
    const capability = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
    if (!capability) throw new Error('缺少宫格切分能力')
    const onExecute = vi.fn()
    const rendered = render(
      <CanvasImageCapabilityActions
        capabilities={[capability]}
        pendingCapabilityId={null}
        onExecute={onExecute}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: capability.titleKey }))
    expect(onExecute).toHaveBeenCalledWith(capability.id)
    expect(rendered.queryByRole('button', { name: 'nodeToolbar.moreImageCapabilities' })).toBeNull()
  })

  it('能力较多时只直显前两项，其余按目录分组进入更多菜单', () => {
    const capabilities = getRegisteredCanvasImageCapabilities().slice(0, 7)
    const partition = partitionCanvasImageCapabilities(capabilities)

    expect(partition.inline.map(({ id }) => id)).toEqual(
      capabilities.slice(0, 2).map(({ id }) => id),
    )
    expect(partition.overflowGroups.flatMap(({ capabilities: items }) => items.map(({ id }) => id)))
      .toEqual(capabilities.slice(2).map(({ id }) => id))
    expect(partition.overflowGroups.map(({ group }) => group))
      .toEqual([...new Set(capabilities.slice(2).map(({ group }) => group))])
  })

  it('执行中禁用所有能力入口，阻止重复触发', () => {
    const capability = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
    if (!capability) throw new Error('缺少宫格切分能力')
    const rendered = render(
      <CanvasImageCapabilityActions
        capabilities={[capability]}
        pendingCapabilityId={capability.id}
        onExecute={vi.fn()}
      />,
    )

    expect(rendered.getByRole('button', { name: capability.titleKey }).hasAttribute('disabled')).toBe(true)
  })

  it('能力目录接管同一本地工具后只保留一个入口', () => {
    const sourceNode: CanvasNode = {
      id: 'image-source',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: 'managed-source.png', aspectRatio: '1:1' },
    }
    const capabilities = getExecutableCanvasImageCapabilitiesForSourceNode(sourceNode)
    const remainingTools = excludeClaimedLocalTools(getNodeToolPlugins(sourceNode), capabilities)

    expect(capabilities.map(({ id }) => id)).toEqual([CANVAS_IMAGE_CAPABILITY_IDS.gridSplit])
    expect(remainingTools.map(({ type }) => type)).toEqual([NODE_TOOL_TYPES.edit])
  })
})
