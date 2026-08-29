import {
  PANORAMA_REFERENCE_TEMPLATE_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from './panoramaPolicy';
import { PORTRAIT_TEXTURE_TEMPLATE_VERSION } from './portraitTexturePolicy';
import { ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION } from './elementEditPolicy';
import type { CanvasImageCapabilityPromptPolicy } from './types';

type CanvasPromptTemplate = (userPrompt: string) => string;

const PANORAMA_TEXT_TEMPLATE: CanvasPromptTemplate = (userPrompt) => `[用户场景描述]
${userPrompt}

[输出用途]
创建一张可在球面全景查看器中浏览的完整场景图。能力固定的球面几何要求优先于用户描述中任何冲突的输出格式。

[固定几何]
- 使用完整等距柱状投影（equirectangular projection）。
- 覆盖水平 360° 和垂直 180° 的完整球面，输出严格 2:1。
- 图像左右边缘必须在环视时无缝连续；接缝两侧的物体、纹理、光照和透视必须一致。
- 顶部天顶和底部地面极点必须连续、完整，不能出现拉裂、空洞、旋涡或拼接痕迹。
- 地平线保持水平，空间尺度和透视在所有方向连续。

[质量约束]
- 不要重复主体、门窗、人物、文字或明显地标来填充不同方向。
- 不要边框、分栏、鱼眼圆框、黑边、说明文字、标志或水印。
- 保留用户描述的主体、风格、时间、天气和材质，不把场景改成普通广角照片。`;

const PANORAMA_REFERENCE_TEMPLATE: CanvasPromptTemplate = (userPrompt) => `[用户编辑要求]
${userPrompt}

[参考图角色]
把输入图片作为场景、主体、身份、风格和材质参考。保留用户明确要求保留的主体特征、颜色关系和视觉语言。
参考图只是已知视角，不是要直接拉伸、镜像或平铺的最终画布；请自然推断并补全未展示的背面、顶部和底部。

[输出用途与固定几何]
将场景扩展为完整等距柱状全景：水平 360°、垂直 180°、严格 2:1。能力固定的球面几何要求优先于用户描述中任何冲突的输出格式。
左右边缘无缝连续；天顶与地面极点连续；地平线水平；各方向光照、透视和空间结构一致。

[质量约束]
- 同一人物或主物体只在合理位置出现一次，除非用户明确要求重复。
- 不新增无关人物、文字、标志、水印、边框、分栏或鱼眼圆框。
- 不改变参考图中被要求保留的身份、服装、主体比例和核心风格。`;

const PROMPT_TEMPLATES: Readonly<Record<string, CanvasPromptTemplate>> = {
  [PANORAMA_TEXT_TEMPLATE_VERSION]: PANORAMA_TEXT_TEMPLATE,
  [PANORAMA_REFERENCE_TEMPLATE_VERSION]: PANORAMA_REFERENCE_TEMPLATE,
  // 人像质感模块已经按版本编译完整隐藏提示词；通用能力层只登记版本，不重复包裹。
  [PORTRAIT_TEXTURE_TEMPLATE_VERSION]: (compiledPrompt) => compiledPrompt,
  // 元素编辑只固定选区语义；用户提示词原样交给已核验的遮罩编辑模型。
  [ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION]: (userPrompt) => userPrompt,
};

export function resolveCanvasCapabilityPromptTemplateVersion(
  policy: CanvasImageCapabilityPromptPolicy,
  referenceImageCount: number,
): string | null {
  if (referenceImageCount > 0) {
    return policy.hiddenTemplateVersions?.reference
      ?? policy.hiddenTemplateVersion;
  }
  return policy.hiddenTemplateVersions?.text
    ?? policy.hiddenTemplateVersion;
}

export function buildCanvasCapabilityPrompt(
  policy: CanvasImageCapabilityPromptPolicy,
  userPrompt: string,
  referenceImageCount: number,
): { prompt: string; templateVersion: string | null } {
  const templateVersion = resolveCanvasCapabilityPromptTemplateVersion(
    policy,
    referenceImageCount,
  );
  if (!templateVersion) {
    return { prompt: userPrompt, templateVersion: null };
  }
  const template = PROMPT_TEMPLATES[templateVersion];
  if (!template) {
    throw new Error(`图片能力提示词模板尚未注册：${templateVersion}`);
  }
  return {
    prompt: template(userPrompt),
    templateVersion,
  };
}
