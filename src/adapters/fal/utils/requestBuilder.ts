/**
 * 请求构建工具
 * 职责：构建 Fal API 请求
 */

export function buildRequest(model: string, params: any) {
  // 构建请求对象
  // TODO: 实现具体的请求构建逻辑
  return {
    model,
    params
  }
}

export function buildHeaders(apiKey: string) {
  // 构建请求头
  return {
    'Authorization': `Key ${apiKey}`,
    'Content-Type': 'application/json'
  }
}
