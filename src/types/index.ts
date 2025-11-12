export interface MediaResult {
  id: string
  type: 'image' | 'video' | 'audio'
  url: string
  filePath?: string
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
