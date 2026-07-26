import { describe, expect, it } from 'vitest';

import {
  UI_DIALOG_TRANSITION_MS,
  UI_DATA_TWEEN_MS,
  UI_DURATION,
  UI_DURATION_CLASS,
  UI_POPOVER_TRANSITION_MS,
} from './motion';

describe('动效档位', () => {
  it('每一档的 ms 数值与同名 Tailwind 类一致', () => {
    // 两边必须都写字面量（Tailwind 扫不到运行时拼接的类名），
    // 所以只能靠测试防止它们漂移。对不上就意味着 JS 卸载计时
    // 与 CSS 过渡时长错位，过渡收尾会被硬切。
    for (const key of Object.keys(UI_DURATION) as (keyof typeof UI_DURATION)[]) {
      expect(UI_DURATION_CLASS[key]).toBe(`duration-${UI_DURATION[key]}`);
    }
  });

  it('语义化计时常量落在已登记档位上', () => {
    const registered: number[] = Object.values(UI_DURATION);
    expect(registered).toContain(UI_DIALOG_TRANSITION_MS);
    expect(registered).toContain(UI_POPOVER_TRANSITION_MS);
  });

  it('数据补间档独立于交互反馈档位', () => {
    expect(UI_DATA_TWEEN_MS).toBe(2800);
    expect(Object.values(UI_DURATION)).not.toContain(UI_DATA_TWEEN_MS);
  });
});
