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
