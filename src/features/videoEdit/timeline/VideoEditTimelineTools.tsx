import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BetweenVerticalStart, ChevronsLeftRight, Circle, Columns2, Gauge, Hand, Hash, Highlighter, LetterText, MessageSquare, MousePointer2, MoveHorizontal, MoveUpRight, PenLine, PenTool, Scissors, Square, Type, ZoomIn, type LucideIcon } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiIconButton } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { VideoEditCommandId, VideoEditToolCommandId } from '@/core/videoEdit/commands'
import type { VideoEditAnnotationShape } from '../application/videoEditAnnotations'
import type { timelineCommandPresentation } from './timelineCommandPresentation'

type Presentation = ReturnType<typeof timelineCommandPresentation>
const TOOL_ICONS: Record<VideoEditToolCommandId, LucideIcon> = {
  select_tool: MousePointer2, track_tool: ArrowRight, track_backward_tool: ArrowLeft, ripple_tool: BetweenVerticalStart, roll_tool: Columns2, rate_stretch_tool: Gauge,
  razor_tool: Scissors, slip_tool: ChevronsLeftRight, slide_tool: MoveHorizontal, pen_tool: PenTool, hand_tool: Hand, zoom_tool: ZoomIn, type_tool: Type, annotate_tool: Highlighter,
}
/** 批注形状的图标：命令带里批注参数条的形状组用（与 1–7 同序）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 工具组与批注参数条共用同一份形状图标
export const VIDEO_EDIT_ANNOTATION_SHAPE_ICONS: Record<VideoEditAnnotationShape, LucideIcon> = { arrow: MoveUpRight, ellipse: Circle, region: Square, stroke: PenLine, text: LetterText, marker: Hash, point: MessageSquare }
/** 与 PR 工具面板相同的分组：同组工具共用一个按钮，按住或右键选组内其他工具，快捷键直接切换。 */
const TOOL_GROUPS: readonly (readonly VideoEditToolCommandId[])[] = [
  ['select_tool'], ['track_tool', 'track_backward_tool'], ['ripple_tool', 'roll_tool', 'rate_stretch_tool'], ['razor_tool'], ['slip_tool', 'slide_tool'], ['pen_tool'], ['hand_tool', 'zoom_tool'], ['type_tool'],
]
/** 按住多久弹出同组工具（PR 按住工具按钮弹出）。 */
const HOLD_MS = 350

/** 剪辑命令带里的编辑工具组（模式，当前工具用 `on selection="mode"`，重要记录 019）。批注工具的形状与颜色在紧跟其后的批注参数条里。 */
export function VideoEditTimelineTools({ presentation, execute }: { presentation: (id: VideoEditCommandId) => Presentation; execute: (id: VideoEditToolCommandId) => void }): React.ReactElement {
  const menu = useContextMenu()
  // 每组上次用过的工具；当前工具属于这一组时显示当前工具。
  const [recent, setRecent] = useState<Record<number, VideoEditToolCommandId>>({})
  const hold = useRef<ReturnType<typeof setTimeout>>()
  const held = useRef(false)
  const choose = (group: number, id: VideoEditToolCommandId): void => { setRecent(value => ({ ...value, [group]: id })); execute(id) }
  const openGroup = (group: number, anchor: Element): void => {
    menu.showMenuAt(anchor, TOOL_GROUPS[group].map(id => { const Icon = TOOL_ICONS[id]; const command = presentation(id); return { id, label: command.tooltip, icon: <Icon size={UI_ICON_SIZE.md} />, disabled: !command.enabled, onClick: () => choose(group, id) } }))
  }
  return <div className="ml-2 flex items-center gap-0.5" role="group" aria-label="时间线工具">
    {TOOL_GROUPS.map((members, group) => {
      const active = members.find(id => presentation(id).checked)
      const id = active ?? recent[group] ?? members[0]
      const command = presentation(id); const Icon = TOOL_ICONS[id]
      const grouped = members.length > 1
      return <UiIconButton key={group} selection="mode" on={command.checked} disabled={!command.enabled} aria-label={command.title} aria-haspopup={grouped ? 'menu' : undefined}
        tooltip={grouped ? `${command.tooltip}（按住或右键切换：${members.filter(member => member !== id).map(member => presentation(member).title).join('、')}）` : command.tooltip}
        onPointerDown={event => {
          if (!grouped || event.button !== 0) return
          held.current = false; const anchor = event.currentTarget
          clearTimeout(hold.current); hold.current = setTimeout(() => { held.current = true; openGroup(group, anchor) }, HOLD_MS)
        }}
        onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
        onContextMenu={event => { if (!grouped) return; event.preventDefault(); openGroup(group, event.currentTarget) }}
        onClick={() => { if (held.current) { held.current = false; return } choose(group, id) }}><Icon  /></UiIconButton>
    })}
    {(() => { const command = presentation('annotate_tool'); return <UiIconButton selection="mode" on={command.checked} disabled={!command.enabled} aria-label={command.title} tooltip={command.tooltip} onClick={() => execute('annotate_tool')}><Highlighter /></UiIconButton> })()}
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
  </div>
}
