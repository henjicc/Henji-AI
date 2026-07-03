/** 时间轴轨道树派生（纯函数）：对象 → 可动画分组 → 分量子轨道，仅保留有轨道的分组 */

import { listAnimatableGroups } from '../domain/animatableProps'
import type { StageTrack } from '../domain/animationTypes'
import type { StageObject } from '../domain/sceneTypes'

export interface TimelineChildRow {
  path: string
  label: string
  track: StageTrack
}

export interface TimelineGroupRow {
  groupPath: string
  label: string
  /** vec3 分组可展开为 X/Y/Z 子轨道；scalar/color 分组单行不展开 */
  isVec3: boolean
  childTracks: StageTrack[]
  childRows: TimelineChildRow[]
}

export interface TimelineObjectRow {
  objectId: string
  objectName: string
  groups: TimelineGroupRow[]
}

export function buildTimelineTree(
  objects: StageObject[],
  tracks: StageTrack[],
): TimelineObjectRow[] {
  const result: TimelineObjectRow[] = []
  for (const object of objects) {
    const groups: TimelineGroupRow[] = []
    for (const group of listAnimatableGroups(object)) {
      const childRows: TimelineChildRow[] = []
      for (const child of group.children) {
        const track = tracks.find(
          (item) => item.objectId === object.id && item.propertyPath === child.path,
        )
        if (track) childRows.push({ path: child.path, label: child.label, track })
      }
      if (childRows.length === 0) continue
      groups.push({
        groupPath: group.groupPath,
        label: group.label,
        isVec3: group.valueType === 'vec3',
        childTracks: childRows.map((row) => row.track),
        childRows,
      })
    }
    if (groups.length > 0) {
      result.push({ objectId: object.id, objectName: object.name, groups })
    }
  }
  return result
}
