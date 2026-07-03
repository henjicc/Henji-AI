import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { useCameraStageStore } from '../store/cameraStageStore'
import GroupLane from './GroupLane'
import TrackLane from './TrackLane'
import type { TimelineObjectRow } from './timelineTree'
import { TIMELINE_LABEL_WIDTH, TIMELINE_ROW_HEIGHT, type EasingEditTarget } from './timelineLayout'

/**
 * 时间轴左侧轨道树 + 右侧泳道行渲染：对象头 → 可动画分组父行（vec3 可展开）→ X/Y/Z 分量子行。
 * 折叠/展开态自持有；关键帧读写走 GroupLane/TrackLane 内的 store 动作。
 */

interface TimelineTrackListProps {
  tree: TimelineObjectRow[]
  pxPerSecond: number
  contentWidth: number
  duration: number
  fps: number
  selectedSet: ReadonlySet<string>
  onOpenEasing: (target: EasingEditTarget, anchor: { x: number; y: number }) => void
}

const LabelCell: React.FC<{
  paddingLeft: number
  background: 'surface' | 'app'
  children: React.ReactNode
}> = ({ paddingLeft, background, children }) => (
  <div
    className={`group sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border-dark pr-1.5 ${
      background === 'surface' ? 'bg-surface-dark' : 'bg-app'
    }`}
    style={{
      width: TIMELINE_LABEL_WIDTH,
      paddingLeft,
      borderBottom: `1px solid ${CAMERA_STAGE_TIMELINE_HEX.laneBorder}`,
    }}
  >
    {children}
  </div>
)

const TimelineTrackList: React.FC<TimelineTrackListProps> = ({
  tree,
  pxPerSecond,
  contentWidth,
  duration,
  fps,
  selectedSet,
  onOpenEasing,
}) => {
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const clearTrack = useCameraStageStore((state) => state.clearTrack)
  const [collapsedObjects, setCollapsedObjects] = useState<ReadonlySet<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set())

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
    key: string,
  ): void => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const laneProps = { pxPerSecond, contentWidth, duration, fps, selectedKeys: selectedSet, onOpenEasing }

  return (
    <>
      {tree.map((object) => {
        const objectCollapsed = collapsedObjects.has(object.objectId)
        return (
          <React.Fragment key={object.objectId}>
            {/* 对象头 */}
            <div className="flex" style={{ height: TIMELINE_ROW_HEIGHT }}>
              <LabelCell paddingLeft={6} background="surface">
                <UiIconButton
                  showBorder={false}
                  appearance="hover-only"
                  className="h-5 w-5"
                  title={objectCollapsed ? '展开' : '收起'}
                  onClick={() => toggle(setCollapsedObjects, object.objectId)}
                >
                  {objectCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </UiIconButton>
                <span
                  role="button"
                  tabIndex={-1}
                  className="cursor-pointer truncate text-left text-xs font-medium text-text-dark"
                  onClick={() => setSelected(object.objectId)}
                  title={object.objectName}
                >
                  {object.objectName}
                </span>
              </LabelCell>
              <div style={{ width: contentWidth }} />
            </div>

            {!objectCollapsed &&
              object.groups.map((group) => {
                const groupKey = `${object.objectId}::${group.groupPath}`
                const groupExpanded = expandedGroups.has(groupKey)
                return (
                  <React.Fragment key={group.groupPath}>
                    {/* 分组父行 */}
                    <div className="flex" style={{ height: TIMELINE_ROW_HEIGHT }}>
                      <LabelCell paddingLeft={22} background="app">
                        {group.isVec3 ? (
                          <UiIconButton
                            showBorder={false}
                            appearance="hover-only"
                            className="h-5 w-5"
                            title={groupExpanded ? '收起分量' : '展开 X/Y/Z 分量'}
                            onClick={() => toggle(setExpandedGroups, groupKey)}
                          >
                            {groupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </UiIconButton>
                        ) : (
                          <span className="w-5 shrink-0" />
                        )}
                        <span
                          role="button"
                          tabIndex={-1}
                          className="flex-1 cursor-pointer truncate text-left text-xs text-text-muted"
                          onClick={() => setSelected(object.objectId)}
                          title={group.label}
                        >
                          {group.label}
                        </span>
                        <UiIconButton
                          showBorder={false}
                          appearance="hover-only"
                          hoverVariant="danger"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100"
                          title="删除该属性全部轨道"
                          onClick={() =>
                            group.childRows.forEach((row) => clearTrack(object.objectId, row.path))
                          }
                        >
                          <Trash2 size={12} />
                        </UiIconButton>
                      </LabelCell>
                      {group.isVec3 ? (
                        <GroupLane objectId={object.objectId} childTracks={group.childTracks} {...laneProps} />
                      ) : (
                        <TrackLane track={group.childRows[0].track} {...laneProps} />
                      )}
                    </div>

                    {/* 分量子行 */}
                    {group.isVec3 &&
                      groupExpanded &&
                      group.childRows.map((row) => (
                        <div className="flex" style={{ height: TIMELINE_ROW_HEIGHT }} key={row.path}>
                          <LabelCell paddingLeft={44} background="app">
                            <span className="truncate text-left text-[11px] text-text-muted">{row.label}</span>
                          </LabelCell>
                          <TrackLane track={row.track} {...laneProps} />
                        </div>
                      ))}
                  </React.Fragment>
                )
              })}
          </React.Fragment>
        )
      })}
    </>
  )
}

export default TimelineTrackList
