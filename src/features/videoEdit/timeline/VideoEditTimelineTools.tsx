import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BetweenVerticalStart, ChevronsLeftRight, Columns2, Hand, MousePointer2, MoveHorizontal, Scissors, Type, ZoomIn, type LucideIcon } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiIconButton } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { VideoEditToolCommandId } from '@/core/videoEdit/commands'
import type { timelineCommandPresentation } from './timelineCommandPresentation'

type Presentation = ReturnType<typeof timelineCommandPresentation>
const TOOL_ICONS: Record<VideoEditToolCommandId, LucideIcon> = {
  select_tool: MousePointer2, track_tool: ArrowRight, track_backward_tool: ArrowLeft, ripple_tool: BetweenVerticalStart, roll_tool: Columns2,
  razor_tool: Scissors, slip_tool: ChevronsLeftRight, slide_tool: MoveHorizontal, hand_tool: Hand, zoom_tool: ZoomIn, type_tool: Type,
}
/** 与 PR 工具面板相同的分组：同组工具共用一个按钮，按住或右键选组内其他工具，快捷键直接切换。 */
const TOOL_GROUPS: readonly (readonly VideoEditToolCommandId[])[] = [
  ['select_tool'], ['track_tool', 'track_backward_tool'], ['ripple_tool', 'roll_tool'], ['razor_tool'], ['slip_tool', 'slide_tool'], ['hand_tool', 'zoom_tool'], ['type_tool'],
]
/** 按住多久弹出同组工具（PR 按住工具按钮弹出）。 */
const HOLD_MS = 350

/** 时间线工具栏里的工具组（模式，选中态用 `on`）。 */
export function VideoEditTimelineTools({ presentation, execute }: { presentation: (id: VideoEditToolCommandId) => Presentation; execute: (id: VideoEditToolCommandId) => void }): React.ReactElement {
  const menu = useContextMenu()
  // 每组上次用过的工具；当前工具属于这一组时显示当前工具。
  const [recent, setRecent] = useState<Record<number, VideoEditToolCommandId>>({})
  const hold = useRef<ReturnType<typeof setTimeout>>()
  const held = useRef(false)
  const choose = (group: number, id: VideoEditToolCommandId): void => { setRecent(value => ({ ...value, [group]: id })); execute(id) }
  const openGroup = (group: number, anchor: Element): void => {
    menu.showMenuAt(anchor, TOOL_GROUPS[group].map(id => { const Icon = TOOL_ICONS[id]; const command = presentation(id); return { id, label: command.tooltip, icon: <Icon size={16} />, disabled: !command.enabled, onClick: () => choose(group, id) } }))
  }
  return <div className="ml-2 flex items-center gap-0.5" role="group" aria-label="时间线工具">
    {TOOL_GROUPS.map((members, group) => {
      const active = members.find(id => presentation(id).checked)
      const id = active ?? recent[group] ?? members[0]
      const command = presentation(id); const Icon = TOOL_ICONS[id]
      const grouped = members.length > 1
      return <UiIconButton key={group} on={command.checked} disabled={!command.enabled} aria-label={command.title} aria-haspopup={grouped ? 'menu' : undefined}
        title={grouped ? `${command.tooltip}（按住或右键切换：${members.filter(member => member !== id).map(member => presentation(member).title).join('、')}）` : command.tooltip}
        onPointerDown={event => {
          if (!grouped || event.button !== 0) return
          held.current = false; const anchor = event.currentTarget
          clearTimeout(hold.current); hold.current = setTimeout(() => { held.current = true; openGroup(group, anchor) }, HOLD_MS)
        }}
        onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
        onContextMenu={event => { if (!grouped) return; event.preventDefault(); openGroup(group, event.currentTarget) }}
        onClick={() => { if (held.current) { held.current = false; return } choose(group, id) }}><Icon size={15} /></UiIconButton>
    })}
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
  </div>
}
