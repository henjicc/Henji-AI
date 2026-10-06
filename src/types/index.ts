export interface MediaResult {
  id: string
  type: 'image' | 'video' | 'audio'
  /** 结果的显示地址，按输出顺序 */
  urls: string[]
  /** 已保存到本地的结果文件，按输出顺序；没保存时为空数组 */
  filePaths: string[]
  base64Data?: string  // 添加Base64数据字段，用于离线下载和复制
  prompt: string
  createdAt: Date
}

export interface Provider {
  id: string
  name: string
  type: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  type: 'image' | 'video' | 'audio'
  description: string
}
