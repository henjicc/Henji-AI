/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UiButton, UiIconButton, UiWindowControl } from './primitives';
import { UI_BUTTON_VARIANT_CLASS } from './primitiveInternals';

afterEach(cleanup);

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { findButtonAppearanceOverridesInSource, classifyToken } = require(path.join(process.cwd(), 'scripts/lib/buttonAppearanceOverrides.cjs')) as {
  findButtonAppearanceOverridesInSource: (raw: string, fileName: string) => { line: number; component: string; violations: { token: string; kind: string }[] }[];
  classifyToken: (token: string, component: string) => string | null;
};

function classes(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

describe('UiButton 档位与尺寸（重要记录 003）', () => {
  it('默认是静默档 quiet + md 32，不带边框与底色类', () => {
    const view = render(<UiButton>默认</UiButton>);
    const button = view.getByRole('button', { name: '默认' });
    expect(button.classList.contains('ui-btn')).toBe(true);
    expect(button.classList.contains('ui-btn-quiet')).toBe(true);
    expect(button.classList.contains('h-control-md')).toBe(true);
    expect(button.dataset.variant).toBe('quiet');
    expect(classes(button).some((name) => /^(bg-|border)/.test(name))).toBe(false);
  });

  it('五档 + link + media 各自只挂自己的皮肤类', () => {
    const variants = ['primary', 'secondary', 'quiet', 'danger', 'dangerSolid', 'link', 'media'] as const;
    const view = render(<>{variants.map((variant) => <UiButton key={variant} variant={variant}>{variant}</UiButton>)}</>);
    for (const variant of variants) {
      const button = view.getByRole('button', { name: variant });
      const skins = classes(button).filter((name) => name.startsWith('ui-btn-'));
      expect(skins).toEqual([UI_BUTTON_VARIANT_CLASS[variant]]);
    }
  });

  it('尺寸 sm/md/lg = 28/32/36，静默档内边距少一档；link 跟随行内文字', () => {
    const view = render(
      <>
        <UiButton size="sm">小</UiButton>
        <UiButton size="lg" variant="primary">大主</UiButton>
        <UiButton size="lg">大静</UiButton>
        <UiButton variant="link" size="lg">链接</UiButton>
      </>,
    );
    expect(view.getByRole('button', { name: '小' }).classList.contains('h-control-sm')).toBe(true);
    const primary = view.getByRole('button', { name: '大主' });
    expect(primary.classList.contains('h-control-lg')).toBe(true);
    expect(primary.classList.contains('px-4')).toBe(true);
    expect(view.getByRole('button', { name: '大静' }).classList.contains('px-3.5')).toBe(true);
    const link = view.getByRole('button', { name: '链接' });
    expect(classes(link).some((name) => name.startsWith('h-'))).toBe(false);
  });

  it('不再接受旧档位名（muted / ghost / plain / glass）', () => {
    // @ts-expect-error 旧档位已删除，调用点必须迁移到新档位
    render(<UiButton variant="muted">旧</UiButton>);
  });
});

describe('UiIconButton 默认静默、on 与 tone', () => {
  it('默认静默（quiet 皮肤）、md 28、圆角控件档', () => {
    const view = render(<UiIconButton aria-label="撤销" />);
    const button = view.getByRole('button', { name: '撤销' });
    expect(button.classList.contains('ui-btn-quiet')).toBe(true);
    expect(button.classList.contains('h-control-sm')).toBe(true);
    expect(button.classList.contains('w-7')).toBe(true);
    expect(button.dataset.tone).toBe('default');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
  });

  it('on 表示开关开启：选中底 + 强调图标，并写出 aria-pressed；显式 aria-pressed 优先', () => {
    const view = render(
      <>
        <UiIconButton on aria-label="吸附" />
        <UiIconButton on={false} aria-label="链接" />
        <UiIconButton on aria-pressed={false} aria-label="输出" />
      </>,
    );
    const snap = view.getByRole('button', { name: '吸附' });
    expect(snap.classList.contains('ui-btn-on')).toBe(true);
    expect(snap.getAttribute('aria-pressed')).toBe('true');
    expect(view.getByRole('button', { name: '链接' }).getAttribute('aria-pressed')).toBe('false');
    expect(view.getByRole('button', { name: '输出' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('tone：media 压在画面上、accent 圆形材质主动作、danger 悬停显红', () => {
    const view = render(
      <>
        <UiIconButton tone="media" aria-label="画面" />
        <UiIconButton tone="media" on aria-label="画面开" />
        <UiIconButton tone="accent" size="lg" aria-label="生成" />
        <UiIconButton tone="danger" aria-label="删除" />
        <UiIconButton tone="media" shape="circle" size="xl" aria-label="上一张" />
      </>,
    );
    expect(view.getByRole('button', { name: '画面' }).classList.contains('ui-btn-media')).toBe(true);
    expect(view.getByRole('button', { name: '画面开' }).classList.contains('ui-btn-media-on')).toBe(true);
    const accent = view.getByRole('button', { name: '生成' });
    expect(accent.classList.contains('ui-btn-primary')).toBe(true);
    expect(accent.classList.contains('rounded-full')).toBe(true);
    expect(accent.classList.contains('h-control-md')).toBe(true);
    expect(view.getByRole('button', { name: '删除' }).classList.contains('ui-btn-danger')).toBe(true);
    const prev = view.getByRole('button', { name: '上一张' });
    expect(prev.classList.contains('rounded-full')).toBe(true);
    expect(prev.classList.contains('h-10')).toBe(true);
  });

  it('尺寸 xs/sm/md/lg = 20/24/28/32', () => {
    const view = render(
      <>
        <UiIconButton size="xs" aria-label="xs" />
        <UiIconButton size="sm" aria-label="sm" />
        <UiIconButton size="lg" aria-label="lg" />
      </>,
    );
    expect(view.getByRole('button', { name: 'xs' }).classList.contains('h-5')).toBe(true);
    expect(view.getByRole('button', { name: 'sm' }).classList.contains('h-6')).toBe(true);
    expect(view.getByRole('button', { name: 'lg' }).classList.contains('h-control-md')).toBe(true);
  });

  it('不再接受旧参数（appearance / showBorder / hoverVariant / active）', () => {
    // @ts-expect-error 旧参数已删除
    render(<UiIconButton appearance="hover-only" aria-label="旧" />);
  });
});

describe('按钮皮肤只用主题令牌（index.css .ui-btn-*）', () => {
  const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
  const block = css.slice(css.indexOf('.ui-btn {'), css.indexOf('.ui-btn-media:disabled'));

  it('皮肤块不写死颜色；按钮扁平：不用渐变、高光投影与按下位移（重要记录 016）', () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(\s*\d/);
    expect(block).not.toMatch(/gradient\(/);
    expect(block).not.toMatch(/translateY/);
    expect(block).not.toMatch(/inset 0 1px/);
    expect(block).toMatch(/\.ui-btn-primary \{[^}]*background-color: rgb\(var\(--accent-rgb\)\)/);
    expect(block).toMatch(/120ms/);
  });
});

describe('check:surface 规则 E：调用点覆盖按钮外观会被拦截', () => {
  it('分类：底色/边框/文字色/圆角/阴影/高度/字号为外观，布局类放行', () => {
    expect(classifyToken('bg-red-500', 'UiButton')).toBe('底色');
    expect(classifyToken('border-transparent', 'UiButton')).toBe('边框');
    expect(classifyToken('text-white', 'UiButton')).toBe('文字色');
    expect(classifyToken('text-xs', 'UiButton')).toMatch(/字号/);
    expect(classifyToken('rounded-full', 'UiButton')).toBe('圆角');
    expect(classifyToken('shadow-panel', 'UiIconButton')).toMatch(/阴影/);
    expect(classifyToken('h-8', 'UiButton')).toMatch(/高度/);
    expect(classifyToken('w-8', 'UiIconButton')).toMatch(/宽度/);
    for (const layout of ['w-full', 'flex-1', 'shrink-0', 'justify-start', 'gap-2', 'px-2', 'absolute', 'opacity-0', 'text-left', 'truncate']) {
      expect(classifyToken(layout, 'UiButton')).toBeNull();
    }
  });

  it('展开条件分支与同文件常量；行级 ui-surface-allow 豁免', () => {
    const source = [
      "const DANGER = 'hover:!bg-red-600 text-white'",
      'export function A({ on }: { on: boolean }) {',
      '  return <>',
      '    <UiButton className={`w-full ${on ? DANGER : "flex-1"}`}>删除</UiButton>',
      '    <UiIconButton className="!h-8 !w-8" aria-label="x" />',
      '    {/* ui-surface-allow 测试豁免 */}',
      '    <UiButton className="bg-panel">豁免</UiButton>',
      '    <UiButton className="w-full shrink-0">布局</UiButton>',
      '  </>',
      '}',
    ].join('\n');
    const findings = findButtonAppearanceOverridesInSource(source, 'Sample.tsx');
    expect(findings.map((finding) => finding.line)).toEqual([4, 5]);
    expect(findings[0].violations.map((violation) => violation.token)).toEqual(['bg-red-600', 'text-white']);
    expect(findings[1].violations.map((violation) => violation.token)).toEqual(['h-8', 'w-8']);
  });
});

describe('check:surface 规则 E（2.2 扩展）：选项、标签、导航与字段触发器', () => {
  it('选项/标签/导航只放行随内容的高度，固定高度与字号走 size', () => {
    for (const component of ['UiOptionButton', 'UiChipButton', 'UiNavButton']) {
      expect(classifyToken('h-full', component)).toBeNull();
      expect(classifyToken('h-auto', component)).toBeNull();
      expect(classifyToken('min-h-24', component)).toBeNull();
      expect(classifyToken('h-8', component)).toMatch(/高度/);
      expect(classifyToken('text-xs', component)).toMatch(/字号/);
      expect(classifyToken('bg-veil-faint', component)).toBe('底色');
    }
    expect(classifyToken('h-full', 'UiButton')).toMatch(/高度/);
  });

  it('下拉与面板触发器检查 buttonClassName，其它组件检查 className', () => {
    const source = [
      'export function A() {',
      '  return <>',
      '    <Dropdown buttonClassName="!h-8 w-36 rounded-md" />',
      '    <PanelTrigger buttonClassName="w-auto max-w-32" renderPanel={() => null} />',
      '    <UiOptionButton className="w-full bg-veil-faint">格子</UiOptionButton>',
      '    <UiChipButton className="h-full">卡片</UiChipButton>',
      '    <UiNavButton className="!h-10 !rounded-lg">导航</UiNavButton>',
      '    <UiFieldTrigger className="w-full text-xs">值</UiFieldTrigger>',
      '  </>',
      '}',
    ].join('\n');
    const findings = findButtonAppearanceOverridesInSource(source, 'Sample.tsx');
    expect(findings.map((finding) => [finding.line, finding.component])).toEqual([
      [3, 'Dropdown'],
      [5, 'UiOptionButton'],
      [7, 'UiNavButton'],
      [8, 'UiFieldTrigger'],
    ]);
    expect(findings[0].violations.map((violation) => violation.token)).toEqual(['h-8', 'rounded-md']);
  });
});

describe('UiWindowControl：标题栏窗口控件（任务 3.1）', () => {
  it('Windows 形态 36×28、静息辅助文字；关闭悬停为危险实底', () => {
    const view = render(
      <>
        <UiWindowControl action="minimize" aria-label="最小化" />
        <UiWindowControl action="close" aria-label="关闭" />
      </>,
    );
    const minimize = view.getByRole('button', { name: '最小化' });
    const close = view.getByRole('button', { name: '关闭' });
    expect(minimize.getAttribute('type')).toBe('button');
    expect(classes(minimize)).toEqual(expect.arrayContaining(['h-control-sm', 'w-9', 'text-text3', 'hover:bg-hover']));
    expect(classes(close)).toEqual(expect.arrayContaining(['hover:bg-danger-solid', 'hover:text-on-danger']));
    expect(classes(minimize)).not.toContain('hover:bg-danger-solid');
    expect(minimize.querySelector('svg')).not.toBeNull();
  });

  it('macOS 交通灯：圆点取状态实底令牌，不用固定调色板', () => {
    const view = render(
      <>
        <UiWindowControl platform="mac" action="close" aria-label="关闭" />
        <UiWindowControl platform="mac" action="minimize" aria-label="最小化" />
        <UiWindowControl platform="mac" action="restore" aria-label="还原" />
      </>,
    );
    const dot = (name: string) => view.getByRole('button', { name }).querySelector('span') as HTMLElement;
    expect(classes(dot('关闭'))).toContain('bg-danger-solid');
    expect(classes(dot('最小化'))).toContain('bg-warning-solid');
    expect(classes(dot('还原'))).toContain('bg-success-solid');
    for (const name of ['关闭', '最小化', '还原']) {
      expect(view.getByRole('button', { name }).outerHTML).not.toMatch(/(?:red|yellow|green)-\d{3}/);
    }
  });

  it('规则 E 同样检查窗口控件的 className', () => {
    const source = [
      'export function A() {',
      '  return <UiWindowControl action="close" className="ml-1 !bg-transparent" />',
      '}',
    ].join('\n');
    const findings = findButtonAppearanceOverridesInSource(source, 'Sample.tsx');
    expect(findings.map((finding) => finding.component)).toEqual(['UiWindowControl']);
    expect(findings[0].violations.map((violation) => violation.token)).toEqual(['bg-transparent']);
  });
});
