/**
 * 音频模型处理器
 * 职责：处理所有 Fal 音频生成模型的请求
 */
export class AudioHandler {
  async generate(model: string, params: any) {
    // 音频模型生成逻辑
    console.log('AudioHandler.generate', model, params)

    // TODO: 实现具体的音频生成逻辑
    throw new Error('AudioHandler.generate not implemented yet')
  }

  async poll(requestId: string) {
    // 轮询音频生成状态
    // TODO: 实现轮询逻辑
    throw new Error('AudioHandler.poll not implemented yet')
  }
}
