/** 调用方中立的能力安全与结果元信息。 */
export type ApplicationDataClass = 'C0' | 'C1' | 'C2' | 'C3'

/** 调用面共用的能力目录；协议和模型消息由各自适配器投影。 */
export interface ApplicationToolDescriptor {
  name: string
  title?: string
  description: string
  inputSchema: { type: 'object'; [key: string]: unknown }
  outputSchema?: { type: 'object'; [key: string]: unknown }
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
}

export interface ApplicationCapabilityPreview {
  title: string
  summary: string
  targetIds: Record<string, string>
  reversible: boolean
  dataClasses: ApplicationDataClass[]
  destination?: string
}

export interface ApplicationUndoReference {
  kind: string
  token: string
}
