import type { AiGenerateResponseDto } from '@henjicc/ai-sdk'

/*
 * 宿主交给渲染层的生成响应（3.6）：多个输出一律用数组，按供应商输出顺序。
 *
 * SDK 生成结果的 `urls` 已按输出顺序给出全部地址（`url` 只是兼容用的拼接串，宿主不读）。
 * SDK DTO 上的 `filePath` 是宿主字段，这里改为 `filePaths` 数组。
 */

export type HostGenerateResponse = Omit<AiGenerateResponseDto, 'url' | 'filePath'> & {
  /** 供应商返回的结果地址，按输出顺序。 */
  urls: string[]
  /** 已保存到本地的结果文件，按输出顺序；还没保存时为空数组。 */
  filePaths: string[]
}

/** SDK 回执 → 宿主响应：取 SDK 给出的地址数组，本地文件留空待保存。 */
export function toHostGenerateResponse(response: AiGenerateResponseDto): HostGenerateResponse {
  const { url: _url, urls, filePath: _filePath, ...rest } = response
  return { ...rest, urls: urls ?? [], filePaths: [] }
}

/** 账本与回执里读出的 JSON 不一定是本版写法：两个数组字段不是字符串数组时按空处理（不兼容旧的拼接写法）。 */
export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}
