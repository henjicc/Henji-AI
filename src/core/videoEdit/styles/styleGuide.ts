/**
 * 风格说明书（style.md）：写给 AI 的风格引导，不是参数表。栏目照搬 Frameflow 的风格模板（2026-10-22 用户确认），
 * 缺栏目不拒绝写入，由渲染样片时提示补齐；正文怎么写见技能 video-edit-code-creation 的 style-kit。
 */
export const STYLE_GUIDE_SECTIONS = [
  { title: '定位', hint: '2–4 句：给谁看、什么场合、要什么感觉、不要什么感觉；信息密度按用途（口播讲解像发布会一屏一个重点，课件教程才留要点）。可附风格坐标（克制↔张扬、精密↔手作、平面↔立体、冷静↔热闹、严肃↔好玩，各 1–5）。' },
  { title: '不变量与自由度', hint: '不变量 3–5 条：一眼能认出这个风格、任何画面都不能丢的东西。自由度：哪些地方鼓励发挥。' },
  { title: '色彩', hint: '按角色写：底色、主文字、次要文字、强调色、语义色、压在实拍上的处理；写清比例与用法。' },
  { title: '字体与排版', hint: '标题、正文、数字各一条字体优先级链；字号阶梯与每档用途、字重档位，以画面高度为参照；字距、行距与中英混排；小字准入（只放编号、单位、来源、时间这类口播与画面里没有的信息，不放复述标题或口播的说明句）。' },
  { title: '版式与构图', hint: '网格与对齐、留白、视觉焦点、信息密度、形状语言（圆角/直角、线条粗细）。' },
  { title: '动效', hint: '运动性格一句话；入场、换位、离场的曲线；快中慢三档时长；谁先动、错峰规律。' },
  { title: '镜头与转场', hint: '一镜到底还是分镜头；转场方式；镜头时长；景深、视差、摄像机运动。' },
  { title: '质感', hint: '颗粒、阴影、辉光、描边、圆角、材质；哪些绝对不用。' },
  { title: '声音', hint: '音效性格、动作和音效对点的规则、音乐类型与节奏；没有要求写“不限”。' },
  { title: '组件', hint: '基础组件逐个写清怎么出现、停留时有什么、怎么离开、由哪几层细节构成：标题（标题框怎么搭建）、花字与关键词、图片与录屏容器、高亮、数据；人名条、来源标注、字幕、片尾按需补，不用写“不用”。再写它们共用的底板、入场与细节层。' },
  { title: '画幅适配', hint: '横屏 16:9 与竖屏 9:16 怎么变：字号参照哪条边、版式怎么重排、竖屏避开的平台遮挡区。' },
  { title: '设计原则', hint: '硬约束：不能违反的结构性原则。倾向：默认这样做，有理由可以不这样。' },
  { title: '正反例', hint: '做：2–4 条典型的好做法。不做：2–4 条最容易犯、最伤风格的做法。' },
  { title: '样片与代码', hint: '样片按标准分镜演示本风格；写明哪些函数可以照搬（缓动、排版、组件绘制），哪些只是样片内容。' },
] as const
export type StyleGuideSectionTitle = typeof STYLE_GUIDE_SECTIONS[number]['title']
export const STYLE_GUIDE_MAX_LENGTH = 64 * 1024
/** 原地生成图片或视频时并入提示词的可选自定义栏目（旧说明书迁移后保留）。 */
export const STYLE_GUIDE_GENERATION_SECTION = '画面生成提示'

export interface StyleGuideSection { title: string; body: string }
const HTML_COMMENT = /<!--[\s\S]*?-->/g
/** `## 标题` 开始一节；第一个二级标题之前的文字（`# 名称`、`> 定位`）作为前言保留。 */
export function parseStyleGuide(guide: string): StyleGuideSection[] {
  const sections: StyleGuideSection[] = []; let current: StyleGuideSection | undefined; const preface: string[] = []
  for (const line of guide.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) { current = { title: heading[1].trim(), body: '' }; sections.push(current); continue }
    if (current) current.body += `${line}\n`; else preface.push(line)
  }
  for (const section of sections) section.body = section.body.trim()
  const lead = preface.join('\n').trim()
  return lead ? [{ title: '', body: lead }, ...sections] : sections
}
/** 栏目正文，去掉模板里的写法注释；没有这一栏时为空串。 */
export function styleGuideSection(guide: string, title: string): string {
  return (parseStyleGuide(guide).find(section => section.title === title)?.body ?? '').replace(HTML_COMMENT, '').trim()
}
/** 规范顺序：前言，固定栏目，作者追加的栏目按原顺序排在后面；空的固定栏目保留标题，方便补写。 */
export function composeStyleGuide(sections: readonly StyleGuideSection[]): string {
  const preface = sections.find(section => !section.title)?.body.trim()
  const fixed = STYLE_GUIDE_SECTIONS.map(spec => sections.find(section => section.title === spec.title) ?? { title: spec.title, body: '' })
  const extra = sections.filter(section => section.title && !STYLE_GUIDE_SECTIONS.some(spec => spec.title === section.title) && section.body.trim())
  return [...(preface ? [preface] : []), ...[...fixed, ...extra].map(section => `## ${section.title}\n${section.body.trim()}`.trim())].join('\n\n') + '\n'
}
/** 新建风格自带的说明书：栏目标题加写法注释，填完删掉注释。 */
export function styleGuideTemplate(name: string, positioning = ''): string {
  return `# ${name}\n\n> ${positioning || '一句话定位：这个风格是什么感觉、适合什么片子。'}\n\n${STYLE_GUIDE_SECTIONS.map(spec => `## ${spec.title}\n\n<!-- ${spec.hint} -->`).join('\n\n')}\n`
}
/** 缺少或只剩注释的栏目，用于渲染样片时提示补齐；为空表示栏目齐全。 */
export function styleGuideMissingSections(guide: string): string[] {
  return STYLE_GUIDE_SECTIONS.filter(spec => !styleGuideSection(guide, spec.title)).map(spec => spec.title)
}
/** 列表里显示的一句话：前言里的 `>` 引用，其次“定位”的第一句。 */
export function styleGuideSummary(guide: string): string {
  const preface = parseStyleGuide(guide).find(section => !section.title)?.body ?? ''
  const quote = /^>\s*(.+)$/m.exec(preface)?.[1]?.trim()
  return quote || styleGuideSection(guide, '定位').split('\n')[0]?.trim() || ''
}
/** 原地生成时并入提示词的一两句画面描述；说明书没有这一栏时为空。 */
export function styleGuideGenerationPrompt(guide: string): string { return styleGuideSection(guide, STYLE_GUIDE_GENERATION_SECTION).replace(/\s+/g, ' ').trim() }
