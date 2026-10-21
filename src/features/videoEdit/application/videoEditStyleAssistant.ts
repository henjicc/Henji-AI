import { openAssistant } from '@/features/assistant'
import { requireVideoEditInstance } from './videoEditService'

/** 风格面板交给助手的两件事：创建风格（四步，不一次生成完），按说明书的“组件”栏生成模板。都走助手的正式入口。 */
export function askAssistantToCreateStyle(projectId: string): void {
  requireVideoEditInstance(projectId)
  openAssistant('帮我创建一个风格预设：', { context: [
    '用户想新建一个风格预设。按 video-edit-code-creation 技能的 style-kit 参考走四步，不要一次性生成完：',
    '1. 想清楚要什么：用在什么片子上、要什么感觉、不要什么；能从用户给的参考、当前工程或已有风格推断的就自己推断，只问会改变方向的问题。',
    '2. 用代码画 2–3 个方向（作者 JS 的 layers 写法，演示标准分镜），放到一条“风格小样”序列里取帧给用户看，方向之间至少两条风格轴明显不同，然后停下来请用户选。',
    '3. 按反馈改，每轮只改用户提到的地方。',
    '4. 存成风格：创建 video_edit.style，按栏目写 guide，把选中方向整理成 sample，再 render_video_edit_style 渲染并看锚点帧自检；最后问要不要设为默认或绑定到当前序列。',
  ].join('\n') })
}
export function askAssistantForStyleTemplates(projectId: string, styleId: string, styleName: string): void {
  requireVideoEditInstance(projectId)
  openAssistant(`按风格“${styleName}”说明书的“组件”一栏生成模板。`, { context: [
    `读 video_edit.style（id ${styleId}）的说明书与样片，按“组件”一栏挑出会反复用到的元素（标题卡、人名条、要点、数据、字幕、片尾等），逐个写成带参数的作者代码放到当前序列，取帧确认像这个风格。`,
    '每个都按 templates 参考整理：该改的做成参数、尺寸跟着内容走、极端内容兜住、时间跟着片段走，并用最短、最长、中英混排、空字符串四组内容压力测试。',
    `整理好后用 create_video_edit_template 登记（styleId 写 ${styleId}，global=true 存进风格库），名称说清是什么、说明写用途。交付时列出生成了哪些模板。`,
  ].join('\n') })
}
