import { LoaderCircle } from 'lucide-react';
import { UI_ICON_SIZE_CLASS } from './styleTokens';
import type { IconButtonSize } from './primitiveInternals';

/** 行内加载；尺寸沿用控件阶梯，图标大小由登记令牌映射。 */
export function UiSpinner({ size = 'md', tone = 'default', active = true }: {
  size?: IconButtonSize;
  tone?: 'default' | 'accent';
  active?: boolean;
}): JSX.Element {
  const iconSize = size === '2xs' ? 'xs' : size === 'xs' || size === 'sm' ? 'sm' : size === 'xl' ? 'lg' : 'md';
  return <LoaderCircle data-ui-spinner aria-hidden="true" className={`shrink-0 ${UI_ICON_SIZE_CLASS[iconSize]} ${active ? 'motion-safe:animate-spin' : ''} ${tone === 'accent' ? 'text-accent-text' : ''}`} />;
}
