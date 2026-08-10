import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STAGE_VIEWPORTS,
  STAGE_VIEWPORT_IDS,
  type StageViewportSource,
} from '../viewport/viewportTypes'
import { VIEWPORT_STATE_VERSION, migrateViewportState } from './cameraStageViewportStore'

/**
 * 四窗格默认布局与它的持久化迁移。
 *
 * 两件事分开守：
 * 1. 默认布局里不能出现两个一样的来源——四个格子只显示三种画面，等于白掉四分之一信息量，
 *    而这正是用户实际看到的现象（左上和右上两个一模一样的自由透视）。
 * 2. 迁移必须真的把老状态搬过来。这份配置是持久化的，只改默认值不升版本的话，老用户
 *    读回本地旧状态，新默认永远不生效——改了等于没改，且从表现上完全看不出来。
 */

function describeSource(source: StageViewportSource): string {
  if (source.kind === 'fixed') return `fixed:${source.view}`
  if (source.kind === 'camera') return `camera:${source.cameraId}`
  return source.kind
}

describe('三维四窗格默认布局', () => {
  it('四个窗格各显示一种画面，没有重复', () => {
    const sources = STAGE_VIEWPORT_IDS.map((id) => describeSource(DEFAULT_STAGE_VIEWPORTS[id].source))
    expect(new Set(sources).size, `默认布局出现重复画面：${sources.join('、')}`).toBe(sources.length)
  })

  it('默认给出一个摄像机视角——这是运镜工具的产出物本身', () => {
    expect(DEFAULT_STAGE_VIEWPORTS.camera.source).toEqual({ kind: 'active_camera' })
    // 跟随当前机位而不是绑死 id：视口配置存在本机、摄像机 id 属于工程，绑死换个工程就失效。
    const bound = STAGE_VIEWPORT_IDS.filter((id) => DEFAULT_STAGE_VIEWPORTS[id].source.kind === 'camera')
    expect(bound, '默认布局不该绑定具体摄像机 id').toEqual([])
  })
})

describe('三维四窗格状态迁移', () => {
  it('v1 的右视图换成摄像机视角，其余保留用户的选择', () => {
    const migrated = migrateViewportState({
      layout: 'quad',
      activeViewportId: 'top',
      maximizedViewportId: null,
      viewports: {
        perspective: { id: 'perspective', source: { kind: 'fixed', view: 'left' } },
        top: { id: 'top', source: { kind: 'fixed', view: 'top' } },
        front: { id: 'front', source: { kind: 'fixed', view: 'back' } },
        right: { id: 'right', source: { kind: 'fixed', view: 'right' } },
      },
    }, 1)

    // 用户自己改过的两格原样保留
    expect(migrated.viewports.perspective.source).toEqual({ kind: 'fixed', view: 'left' })
    expect(migrated.viewports.front.source).toEqual({ kind: 'fixed', view: 'back' })
    // 右视图那一格换成摄像机
    expect(migrated.viewports.camera.source).toEqual({ kind: 'active_camera' })
    expect(Object.keys(migrated.viewports).sort()).toEqual([...STAGE_VIEWPORT_IDS].sort())
    expect(migrated.activeViewportId).toBe('top')
  })

  it('指向已消失窗格的引用被改掉，不留悬空 id', () => {
    const migrated = migrateViewportState({
      layout: 'single',
      activeViewportId: 'right',
      maximizedViewportId: 'right',
      viewports: {
        perspective: { id: 'perspective', source: { kind: 'director' } },
        top: { id: 'top', source: { kind: 'fixed', view: 'top' } },
        front: { id: 'front', source: { kind: 'fixed', view: 'front' } },
        right: { id: 'right', source: { kind: 'fixed', view: 'right' } },
      },
    }, 1)

    // 悬空 id 会让界面表现成"点谁都不高亮""怎么都退不出最大化"
    expect(migrated.activeViewportId).toBe('perspective')
    expect(migrated.maximizedViewportId).toBeNull()
    expect(migrated.layout).toBe('single')
  })

  it('已经是当前版本的状态原样返回', () => {
    const current = {
      layout: 'quad' as const,
      activeViewportId: 'camera' as const,
      maximizedViewportId: null,
      viewports: DEFAULT_STAGE_VIEWPORTS,
    }
    expect(migrateViewportState(current, VIEWPORT_STATE_VERSION)).toEqual(current)
  })

  it('本地没有任何旧状态时回落到完整默认值', () => {
    const migrated = migrateViewportState(undefined, 0)
    expect(migrated.viewports).toEqual(DEFAULT_STAGE_VIEWPORTS)
    expect(migrated.activeViewportId).toBe('perspective')
  })
})
