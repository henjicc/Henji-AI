/**
 * MediaGenerator 常量定义
 */

// 音色预设
export const voicePresets: { id: string; name: string; gender: 'male' | 'female' | 'child' | 'other' }[] = [
  { id: 'male-qn-qingse', name: '青涩青年', gender: 'male' },
  { id: 'male-qn-jingying', name: '精英青年', gender: 'male' },
  { id: 'male-qn-badao', name: '霸道青年', gender: 'male' },
  { id: 'male-qn-daxuesheng', name: '青年大学生', gender: 'male' },
  { id: 'female-shaonv', name: '少女', gender: 'female' },
  { id: 'female-yujie', name: '御姐', gender: 'female' },
  { id: 'female-chengshu', name: '成熟女性', gender: 'female' },
  { id: 'female-tianmei', name: '甜美女性', gender: 'female' },
  { id: 'presenter_male', name: '男性主持人', gender: 'male' },
  { id: 'presenter_female', name: '女性主持人', gender: 'female' },
  { id: 'audiobook_male_1', name: '男性有声书1', gender: 'male' },
  { id: 'audiobook_male_2', name: '男性有声书2', gender: 'male' },
  { id: 'audiobook_female_1', name: '女性有声书1', gender: 'female' },
  { id: 'audiobook_female_2', name: '女性有声书2', gender: 'female' },
  { id: 'clever_boy', name: '聪明男童', gender: 'child' },
  { id: 'cute_boy', name: '可爱男童', gender: 'child' },
  { id: 'lovely_girl', name: '萌萌女童', gender: 'child' },
  { id: 'cartoon_pig', name: '卡通猪小琪', gender: 'other' }
]

// 计算最大图片数量
export const getMaxImageCount = (modelId: string, mode?: string): number => {
  // Vidu Q1: 根据图片数量自动切换模式，所以始终允许上传最多 7 张
  if (modelId === 'vidu-q1') {
    return 7
  }
  if (modelId === 'kling-2.5-turbo') return 1
  if (modelId === 'fal-ai-kling-video-v2.6-pro') return 1 // Kling Video v2.6 Pro 最多 1 张图片
  if (modelId === 'fal-ai-sora-2' || modelId === 'sora-2') return 1 // Sora 2 最多 1 张图片
  if (modelId === 'fal-ai-ltx-2' || modelId === 'ltx-2') {
    // LTX-2: 支持自动切换模式，始终允许上传 1 张图片
    // - 文生视频模式：上传图片后自动切换到图生视频
    // - 图生视频模式：最多 1 张图片
    // - 视频编辑模式：不支持图片（由 needsVideoUpload 控制）
    return 1
  }
  if (modelId === 'minimax-hailuo-2.3') return 1
  if (modelId === 'minimax-hailuo-02') return 2
  if (modelId === 'pixverse-v4.5') return 1  // 派欧云 PixVerse V4.5：最多 1 张图片
  if (modelId === 'wan-2.5-preview') return 1  // 派欧云 Wan 2.5 Preview
  if (modelId === 'fal-ai-wan-25-preview' || modelId === 'wan-25-preview') return 1  // Fal Wan 2.5 Preview：最多 1 张图片
  if (modelId === 'seedance-v1' || modelId === 'seedance-v1-lite' || modelId === 'seedance-v1-pro') return 2

  // Bytedance Seedance v1 (Fal): 根据模式动态限制图片数量
  if (modelId === 'fal-ai-bytedance-seedance-v1' || modelId === 'bytedance-seedance-v1') {
    if (mode === 'reference-to-video') return 12  // 参考生视频：最多 12 张
    if (mode === 'image-to-video') return 2       // 图生视频：最多 2 张（首尾帧）
    return 2  // 文生视频：最多 2 张，上传后自动切换到图生视频
  }

  if (modelId === 'veo3.1' || modelId === 'fal-ai-veo-3.1') {
    if (mode === 'start-end-frame') return 2
    if (mode === 'reference-to-video') return 7
    return 7 // 文/图生视频允许上传多张图片，然后自动切换模式
  }

  // Vidu Q2: 根据模式动态限制图片数量
  if (modelId === 'fal-ai-vidu-q2' || modelId === 'vidu-q2') {
    if (mode === 'reference-to-video') return 7  // 参考生视频：最多 7 张
    if (mode === 'image-to-video') return 1      // 图生视频：最多 1 张
    if (mode === 'video-extension') return 0     // 视频延长：不支持图片
    if (mode === 'text-to-video') return 1       // 文生视频：最多 1 张，上传后自动切换到图生视频
    return 1  // 默认最多 1 张
  }

  // Pixverse V5.5: 最多 2 张图片
  // - 0 张图片：文生视频
  // - 1 张图片：图生视频
  // - 2 张图片：首尾帧（transition）
  if (modelId === 'fal-ai-pixverse-v5.5' || modelId === 'pixverse-v5.5') {
    return 2
  }

  return 6 // 默认图片模型最多6张
}
