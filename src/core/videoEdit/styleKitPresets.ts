import { STYLE_GUIDE_SECTIONS, type StyleKit } from './styleKit'

/** Empty authoring placeholder; visual presets will be supplied separately. */
export const BUILTIN_STYLE_KITS: readonly StyleKit[] = [{
  id: 'builtin:style:blank', name: '自定义风格', revision: 0,
  guide: STYLE_GUIDE_SECTIONS.filter(section => section.required).map(section => `## ${section.title}\n请按当前作品填写。`).join('\n\n'),
  examples: [],
}]
