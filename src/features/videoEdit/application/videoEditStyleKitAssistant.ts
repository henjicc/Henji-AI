import { openAssistant } from '@/features/assistant'
import { styleKitBriefing, type StyleKit } from '@/core/videoEdit/styleKit'
import { requireVideoEditInstance } from './videoEditService'

/**
 * 风格面板交给助手的两件事。都走助手的正式入口，由助手用通用工具写时间线或风格实体；
 * 说明书草稿可能还没保存，所以把面板里正在编辑的全文放进上下文。
 */
export function askAssistantForStyleExample(projectId: string, kit: StyleKit): void {
  requireVideoEditInstance(projectId)
  const existing = kit.examples.map(example => `“${example.title}”`).join('、')
  const context = [
    `用户在风格面板请你按下面这份风格说明书写一段新的参考示例，用来检验说明书写得够不够清楚。说明书可能还没保存或绑定，以下面的全文为准。`,
    `从零写一段约 3 秒的代码素材，放到当前序列播放头处的空轨道上。挑说明书里最有代表性的两三条规矩来演示，“可以自由发挥”的部分自己做主。${existing ? `已有示例 ${existing}，不要重复它们演示的内容。` : ''}`,
    '写完取帧读图，逐条对照“必须”自查。交付时说明它演示了哪几条规矩、说明书里哪些地方写得含糊让你只能自己猜；最后告诉用户：满意的话在时间线上选中它，在风格面板点“把所选代码片段加为示例”。',
    styleKitBriefing(kit, { examples: false }),
  ].join('\n\n')
  openAssistant(`按风格“${kit.name}”的说明书写一段新的参考示例。`, { autoSend: true, context })
}

export function askAssistantToDraftStyleKit(projectId: string): void {
  requireVideoEditInstance(projectId)
  const context = [
    '用户想新建一份风格说明书。按 video-edit-code-creation 技能的 style-kit 参考起草：读用户给的图片、视频或描述（时间线上选中的片段也可以取帧参考），把配色、版式、字体、动作、节奏写成完整章节；具体值直接写，理念配上能取帧判断的判据；可以附一到三段参考示例代码。',
    '用户只给了模糊的描述时，可以先起草两三个差异明显的方向。',
    '创建为当前工程的 video_edit.style_kit，不绑定序列。交付时告诉用户：在风格面板的“风格”下拉里选中它查看和修改，满意后再绑定或存进风格库。',
  ].join('\n\n')
  openAssistant('参考我给的素材或描述，起草一份风格说明书：', { context })
}
