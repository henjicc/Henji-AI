import React, { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { UiButton } from '@/components/ui'
import type { StageObject } from '../../domain/sceneTypes'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotTimingPatch, ShotTransitionPatch } from '../../store/shotSlice'
import { buildClipLayout, findClipAtTime } from './shotClipGeometry'
import { SHOT_CLIP_TRACK_HEIGHT } from './shotTimelineLayout'
import StaticClipBlock from './StaticClipBlock'
import TransitionClipBlock from './TransitionClipBlock'

const ADD_BLOCK_WIDTH = 104

interface ShotClipTrackProps {
  shots: StageShot[]
  objects: StageObject[]
  pxPerSecond: number
  contentWidth: number
  fps: number
  selectedShotId: string | null
  currentTime: number
  onSelectShot: (id: string) => void
  onRenameShot: (id: string, name: string) => void
  onRemoveShot: (id: string) => void
  onUpdateShotTiming: (id: string, patch: ShotTimingPatch) => void
  onUpdateShotTransition: (id: string, patch: ShotTransitionPatch) => void
  onAddShot: () => void
}

/** 时间轴块轨道：消费 buildClipLayout 渲染静止块/过渡块，末尾接"+ 添加片段"虚线块（不参与时间映射） */
const ShotClipTrack: React.FC<ShotClipTrackProps> = ({
  shots,
  objects,
  pxPerSecond,
  contentWidth,
  fps,
  selectedShotId,
  currentTime,
  onSelectShot,
  onRenameShot,
  onRemoveShot,
  onUpdateShotTiming,
  onUpdateShotTransition,
  onAddShot,
}) => {
  const layout = useMemo(() => buildClipLayout(shots, pxPerSecond), [shots, pxPerSecond])
  const playheadBlock = useMemo(() => findClipAtTime(layout, currentTime), [layout, currentTime])

  return (
    <div className="flex items-stretch" style={{ height: SHOT_CLIP_TRACK_HEIGHT }}>
      <div className="relative shrink-0" style={{ width: contentWidth, height: SHOT_CLIP_TRACK_HEIGHT }}>
        {shots.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">
            点击「添加片段」记录当前画面
          </div>
        )}
        {layout.map((block) => (
          block.kind === 'static' ? (
            <StaticClipBlock
              key={`static-${block.shotId}`}
              shot={shots[block.index]}
              block={block}
              selected={block.shotId === selectedShotId}
              isPlayhead={playheadBlock?.kind === 'static' && playheadBlock.shotId === block.shotId}
              onSelect={() => onSelectShot(block.shotId)}
              onRename={(name) => onRenameShot(block.shotId, name)}
              onRemove={() => onRemoveShot(block.shotId)}
            />
          ) : (
            <TransitionClipBlock
              key={`transition-${block.shotId}`}
              shot={shots[block.index]}
              nextShot={shots[block.index + 1]}
              shotIndex={block.index}
              block={block}
              objects={objects}
              fps={fps}
              updateShotTiming={onUpdateShotTiming}
              updateShotTransition={onUpdateShotTransition}
            />
          )
        ))}
      </div>
      <UiButton
        variant="ghost"
        className="my-1 ml-2 shrink-0 border-dashed text-xs"
        style={{ width: ADD_BLOCK_WIDTH }}
        onClick={onAddShot}
      >
        <Plus size={14} className="mr-1" />添加片段
      </UiButton>
    </div>
  )
}

export default ShotClipTrack
