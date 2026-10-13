import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import resolveConfig from 'tailwindcss/resolveConfig';
import loadConfig from 'tailwindcss/loadConfig';
import { beforeAll, describe, expect, it } from 'vitest';
import { UI_DURATION, UI_EASE, UI_LOOP_MS, UI_POPOVER_TRANSITION_MS } from './motion';

const indexCss = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
const config = loadConfig(path.resolve(__dirname, '../../../tailwind.config.js'));
const css = postcss.parse(indexCss);
const theme = resolveConfig(config).theme;
let compiled: postcss.Root;

beforeAll(async () => {
  const result = await postcss([tailwindcss({
    ...config,
    // eslint-disable-next-line no-restricted-syntax -- 故意编译被禁止的 duration-150，证明它不再生成档位外 CSS。
    content: [{ raw: 'transition-colors duration-120 duration-180 duration-240 duration-500 duration-150 animate-scale-in animate-scale-out animate-fade-in animate-fade-out animate-pulse motion-safe:animate-pulse animate-spin animate-radioDotAppear', extension: 'html' }],
  })]).process(indexCss, { from: undefined });
  compiled = result.root;
});

function declaration(selector: string, property: string): string | undefined {
  let value: string | undefined;
  compiled.walkRules(selector, rule => rule.walkDecls(property, decl => { value = decl.value; }));
  return value;
}

describe('CSS 与 JS 的动效契约', () => {
  it('Tailwind 默认 base，工具类只提供四档（没有继承 150ms）', () => {
    expect(theme.transitionDuration).toEqual({ DEFAULT: '180ms', 120: '120ms', 180: '180ms', 240: '240ms', 500: '500ms' });
    expect(declaration('.transition-colors', 'transition-duration')).toBe(`${UI_DURATION.base}ms`);
    expect(declaration('.duration-150', 'transition-duration')).toBeUndefined();
    for (const ms of Object.values(UI_DURATION)) expect(declaration(`.duration-${ms}`, 'transition-duration')).toBe(`${ms}ms`);
  });

  it('CSS 根令牌与 JS 镜像一致，按钮的每个过渡都用 fast 与统一缓动', () => {
    const vars = new Map<string, string>();
    css.walkRules(':root', rule => rule.walkDecls(decl => { vars.set(decl.prop, decl.value); }));
    for (const [name, ms] of Object.entries(UI_DURATION)) expect(vars.get(`--ui-duration-${name}`)).toBe(`${ms}ms`);
    expect(vars.get('--ui-ease')).toBe(UI_EASE);
    for (const [name, ms] of Object.entries(UI_LOOP_MS)) expect(vars.get(`--ui-loop-${name}`)).toBe(`${ms}ms`);
    css.walkRules('.ui-btn', rule => rule.walkDecls('transition', decl => {
      expect(decl.value.split(',').map(value => value.trim())).toEqual(['background-color', 'color', 'box-shadow', 'transform'].map(property => `${property} var(--ui-duration-fast) var(--ui-ease)`));
    }));
  });

  it('展开/收起与浮层计时一致，淡入/淡出与 Tooltip slow 档一致', () => {
    expect(UI_POPOVER_TRANSITION_MS).toBe(UI_DURATION.base);
    for (const name of ['scale-in', 'scale-out']) expect(declaration(`.animate-${name}`, 'animation')).toBe(`ui-${name} var(--ui-duration-base) var(--ui-ease) forwards`);
    for (const name of ['fade-in', 'fade-out']) expect(declaration(`.animate-${name}`, 'animation')).toBe(`ui-${name} var(--ui-duration-slow) var(--ui-ease) forwards`);
  });

  it('动画工具类只由 Tailwind 生成，关键帧同一作用域无重名，变体复用相同定义', () => {
    css.walkRules(rule => expect(rule.selector).not.toMatch(/\.animate-/));
    const selectors = new Set<string>();
    const frames = new Map<string, string>();
    const scopes = new Set<string>();
    compiled.walkRules(rule => {
      if (!rule.selector.startsWith('.animate-')) return;
      expect(selectors.has(rule.selector), rule.selector).toBe(false);
      selectors.add(rule.selector);
    });
    compiled.walkAtRules('keyframes', frame => {
      const scope = `${frame.parent?.type === 'atrule' ? frame.parent.toString().split('{')[0] : 'root'}:${frame.params}`;
      expect(scopes.has(scope), scope).toBe(false);
      scopes.add(scope);
      if (!frame.nodes) throw new Error(`关键帧缺少内容：${frame.params}`);
      const definition = frame.nodes.map(node => node.toString()).join('\n').replace(/\s+/g, ' ');
      if (frames.has(frame.params)) expect(definition).toBe(frames.get(frame.params));
      frames.set(frame.params, definition);
      expect(frame.params).toMatch(/^ui-/);
    });
    expect(selectors).toContain('.animate-scale-in');
    expect(declaration('.animate-pulse', 'animation')).toBe('ui-pulse var(--ui-loop-pulse) var(--ui-ease) infinite');
    expect(frames.get('ui-pulse')).toContain('0.5');
  });

  it('index.css 动效只引用令牌，无独立时长与未登记缓动', () => {
    css.walkDecls(/^(?:animation|transition)(?:-duration|-timing-function)?$/, decl => {
      if (decl.parent?.parent?.type === 'atrule' && decl.parent.parent.params === '(prefers-reduced-motion: reduce)') return;
      expect(decl.value.replace(/var\([^)]*\)/g, ''), decl.toString()).not.toMatch(/\b\d+(?:\.\d+)?m?s\b|\bease(?:-in|-out|-in-out)?\b|cubic-bezier\(/);
      expect(decl.value).toContain('var(--ui-');
    });
  });

  it('减少动效覆盖伪元素、延迟与循环，必要动效须显式标记', () => {
    const media = css.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(prefers-reduced-motion: reduce)');
    expect(media).toBeDefined();
    const reduced = media?.toString() ?? '';
    expect(reduced).toContain('*:not([data-motion-essential])');
    expect(reduced).toContain('::before');
    expect(reduced).toContain('::after');
    expect(reduced).toContain('transition-duration: 0.01ms !important');
    expect(reduced).toContain('animation-duration: 0.01ms !important');
    expect(reduced).toContain('animation-iteration-count: 1 !important');
    expect(reduced).toContain('animation-delay: 0ms !important');
  });

  it('逐字预览仅淡入，inline 换行不变且不永久提升合成层', () => {
    const glyph = css.nodes.find(node => node.type === 'rule' && node.selector === '.prompt-optimize-preview__glyph');
    expect(glyph?.toString()).not.toContain('will-change');
    expect(glyph?.toString()).toContain('display: inline');
    const frame = css.nodes.find(node => node.type === 'atrule' && node.params === 'ui-prompt-optimize-glyph-in');
    expect(frame).toBeDefined();
    expect(frame?.toString()).not.toContain('transform');
  });
});
