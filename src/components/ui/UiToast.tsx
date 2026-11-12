import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useTranslation } from 'react-i18next';
import type { NotificationMessage } from '@/i18n/notifications';
import { Check, CircleAlert, X } from 'lucide-react';

import { UiButton, UiIconButton, UiPanel } from './primitives';
import { UiSegmented } from './UiSegmented';
import Tooltip from './Tooltip';
import { UI_TEXT_BODY_CLASS } from './styleTokens';

export type UiToastTone = 'success' | 'error' | 'warning';
/** `emphasis`：`quiet`（默认）是可选的恢复动作；`primary` 只给常驻提示里提示本身建议的那一步（如“创建代理”）。 */
export interface UiToastAction { label: string; onClick: () => void; emphasis?: 'quiet' | 'primary' }
/** 主动作前的一个小选项（2~5 个短选项，如分辨率），主动作按选中的值执行。 */
export interface UiToastChoice<T extends string = string> { label: string; options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (value: T) => void }

export interface UiToastProps {
  message: NotificationMessage;
  tone: UiToastTone;
  /** 淡出期间传 false：保持挂载，只做透明度与位移过渡。 */
  visible?: boolean;
  /**
   * 表面：`solid` 压在纯色界面上（默认）；`glass` 只用于压在画布、图片、视频上。
   */
  surface?: 'solid' | 'glass';
  /**
   * 定位：`window` 固定在窗口顶部、标题栏下方居中；`container` 相对最近的定位祖先顶部居中（画布内）；
   * `inline` 留在所在面板的文档流里（常驻提示：不盖住画面与操作，正文单行、放不下截断）。
   */
  placement?: 'window' | 'container' | 'inline';
  action?: UiToastAction;
  choice?: UiToastChoice;
  /** 常驻提示的关闭；不传就没有关闭按钮（短暂通知自己淡出）。 */
  onClose?: () => void;
}

const PLACEMENT_CLASS: Record<NonNullable<UiToastProps['placement']>, string> = {
  window: 'fixed top-14 left-1/2 z-toast -translate-x-1/2',
  container: 'absolute top-4 left-1/2 z-toast -translate-x-1/2',
  inline: 'flex min-w-0 justify-center',
};

/**
 * 通知提示（任务 5.7 收敛：全局通知、生成页通知、画布连线提示原为三套实现）。
 * 浮层表面 + 正文文字，状态只进图标颜色；不抢焦点、不拦截指针（有动作或关闭时才接收点击）。状态与时长由调用方管理。
 */
export function UiToast({ message, tone, visible = true, surface = 'solid', placement = 'window', action, choice, onClose }: UiToastProps): JSX.Element {
  const { t } = useTranslation('ui');
  const text = typeof message === 'string' ? message : t(`notifications.${message.key}`, message.values);
  const Icon = tone === 'success' ? Check : CircleAlert;
  const inline = placement === 'inline';
  const interactive = !!(action || choice || onClose);
  return (
    <div
      className={`${interactive && visible ? 'pointer-events-auto' : 'pointer-events-none'} ${PLACEMENT_CLASS[placement]} transition-[opacity,transform] duration-240 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      }`}
    >
      <UiPanel
        variant={surface === 'glass' ? 'glass' : 'panel'}
        role={tone === 'success' ? 'status' : 'alert'}
        data-tone={tone}
        floating
        className={`flex min-w-0 gap-3 px-4 ${inline ? 'max-w-full items-center py-2' : 'max-w-lg items-start py-3'}`}
      >
        <Icon
          aria-hidden="true"
          className={`${UI_ICON_SIZE_CLASS.md} ${inline ? '' : 'mt-0.5'} shrink-0 ${tone === 'success' ? 'text-success-text' : tone === 'warning' ? 'text-warning-text' : 'text-danger-text'}`}
        />
        {inline
          ? <Tooltip content={text} asChild><span className={`${UI_TEXT_BODY_CLASS} min-w-0 truncate`}>{text}</span></Tooltip>
          : <span className={`${UI_TEXT_BODY_CLASS} min-w-0 break-words`}>{text}</span>}
        {choice && <div className="shrink-0"><UiSegmented ariaLabel={choice.label} size="sm" options={choice.options} value={choice.value} onChange={choice.onChange} disabled={!visible} /></div>}
        {action && <UiButton size="sm" variant={action.emphasis ?? 'quiet'} className="shrink-0" disabled={!visible} onClick={action.onClick}>{action.label}</UiButton>}
        {onClose && <UiIconButton size="sm" className="shrink-0" label={t('windowControls.close')} tooltip={t('windowControls.close')} onClick={onClose}><X /></UiIconButton>}
      </UiPanel>
    </div>
  );
}
