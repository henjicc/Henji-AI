import type { StructuredGenerationOutput } from '@henjicc/ai-sdk'

/** 将宿主按原始输出索引落盘的路径补回 SDK 结构化结果，不改变供应商层序。 */
export function materializeStructuredOutput(
  output: StructuredGenerationOutput | undefined,
  paths: readonly string[]
): StructuredGenerationOutput | undefined {
  if (!output) return undefined
  const outputs = output.outputs.map((item) => ({
    ...item,
    ...(paths[item.sourceOutputIndex] ? { filePath: paths[item.sourceOutputIndex] } : {}),
  }))
  const primary = outputs.find((item) => item.sourceOutputIndex === output.primary.sourceOutputIndex)
    ?? outputs[0]
  return { ...output, outputs, primary }
}
