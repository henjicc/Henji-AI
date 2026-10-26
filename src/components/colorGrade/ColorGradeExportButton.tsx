import { FileDown } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { ColorGradeExportFormat, ColorGradeLutSize } from '@/core/imaging/lut/colorGradeExport'

/**
 * 全能调色面板的导出入口（剪辑与图片两宿主共用）：一个静默图标按钮，点开是三项动作菜单。
 * 宿主负责选路径与调用导出服务；这里只决定入口外观与选项。
 */
export function ColorGradeExportButton({ disabled, disabledReason, busy, onExport }: { disabled?: boolean; disabledReason?: string; busy?: boolean; onExport: (format: ColorGradeExportFormat, lutSize?: ColorGradeLutSize) => void }): React.ReactElement {
  const menu = useContextMenu()
  const icon = <FileDown size={UI_ICON_SIZE.sm} />
  return <>
    <UiIconButton size="xs" tooltip="导出调色为 LUT 或 CDL" aria-label="导出调色" disabled={disabled} disabledReason={disabledReason} loading={busy}
      onClick={event => menu.showMenuAt(event.currentTarget, [
        { id: 'cube', label: '导出 3D LUT（.cube，33 格点）', icon, onClick: () => onExport('cube', 33) },
        { id: 'cube-65', label: '导出高精度 3D LUT（65 格点）', icon, onClick: () => onExport('cube', 65) },
        { id: 'cdl', label: '导出 ASC CDL（.cdl，近似）', icon, onClick: () => onExport('cdl') },
      ])}><FileDown /></UiIconButton>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
  </>
}
