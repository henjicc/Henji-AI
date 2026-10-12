import { z } from 'zod'

/** 共用 Zod issue 投影；只披露字段和约束，不回显调用者输入值。 */
export function describeInputIssues(error: z.ZodError, schema?: z.ZodType): string {
  const accepted = schema instanceof z.ZodObject ? Object.keys(schema.shape) : []
  return error.issues.map(issue => {
    const field = issue.path.map(String).join('.') || '参数'
    if (issue.code === 'unrecognized_keys') {
      return `不认识的参数：${issue.keys.map(key => issue.path.length ? `${field}.${key}` : key).join('、')}。${accepted.length && !issue.path.length ? `这个工具接受：${accepted.join('、')}。` : ''}`
    }
    if (issue.code === 'invalid_type') return `${field} 缺失或类型错误，期望 ${issue.expected}。`
    if (issue.code === 'invalid_value') return `${field} 必须为：${issue.values.map(String).join('、')}。`
    return `${field}：${issue.message}`
  }).join('；')
}

export function invalidInputMessage(error: unknown, schema?: z.ZodType): string | null {
  return error instanceof z.ZodError ? `INVALID_INPUT:${describeInputIssues(error, schema)}` : null
}
