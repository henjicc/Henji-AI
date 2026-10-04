import { Check, CircleAlert } from 'lucide-react';

import { UiPanel } from './primitives';
import { UI_TEXT_BODY_CLASS } from './styleTokens';

export type UiToastTone = 'success' | 'error';

export interface UiToastProps {
  message: string;
  tone: UiToastTone;
  /** 淡出期间传 false：保持挂载，只做透明度与位移过渡。 */
  visible?: boolean;
  /**
   * 表面：`solid` 压在纯色界面上（默认）；`glass` 只用于压在画布、图片、视频上。
   */
  surface?: 'solid' | 'glass';
  /**
   * 定位：`window` 固定在窗口顶部、标题栏下方居中；`container` 相对最近的定位祖先顶部居中（画布内）。
   */
  placement?: 'window' | 'container';
}

const PLACEMENT_CLASS: Record<NonNullable<UiToastProps['placement']>, string> = {
  window: 'fixed top-14',
  container: 'absolute top-4',
};

/**
 * 通知提示（任务 5.7 收敛：全局通知、生成页通知、画布连线提示原为三套实现）。
 * 浮层表面 + 正文文字，状态只进图标颜色；不抢焦点、不拦截指针。状态与时长由调用方管理。
 */
export function UiToast({ message, tone, visible = true, surface = 'solid', placement = 'window' }: UiToastProps): JSX.Element {
  const Icon = tone === 'success' ? Check : CircleAlert;
  return (
    <div
      className={`pointer-events-none ${PLACEMENT_CLASS[placement]} left-1/2 z-toast -translate-x-1/2 transition-[opacity,transform] duration-240 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      }`}
    >
      <UiPanel
        variant={surface === 'glass' ? 'glass' : 'panel'}
        role={tone === 'error' ? 'alert' : 'status'}
        data-tone={tone}
        className="flex max-w-lg items-start gap-2.5 px-4 py-2.5"
      >
        <Icon
          aria-hidden="true"
          className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'success' ? 'text-success-text' : 'text-danger-text'}`}
        />
        <span className={`${UI_TEXT_BODY_CLASS} min-w-0 break-words`}>{message}</span>
      </UiPanel>
    </div>
  );
}
