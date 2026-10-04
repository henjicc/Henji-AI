import type { MouseEvent } from 'react'
import { Unlink } from 'lucide-react'

import { UiIconButton } from '@/components/ui'

interface EdgeDisconnectButtonProps {
  label: string
  onDisconnect: () => void
}

/**
 * 选中连线时出现的断开按钮（普通连线与素材组绑定共用）。画布底随主题，不用固定深色的 media 档：
 * 与画布返回按钮同一做法——随主题的玻璃包一个静默图标按钮；断开是破坏性动作，静息静默、悬停显红。
 */
export function EdgeDisconnectButton({ label, onDisconnect }: EdgeDisconnectButtonProps): JSX.Element {
  return (
    <span className="ui-glass inline-flex rounded-full p-0.5">
      <UiIconButton
        shape="circle"
        size="sm"
        tone="danger"
        type="button"
        aria-label={label}
        title={label}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          onDisconnect()
        }}
      >
        <Unlink className="h-3.5 w-3.5" />
      </UiIconButton>
    </span>
  )
}
