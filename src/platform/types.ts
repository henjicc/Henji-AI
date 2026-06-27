export type ShellKind = 'electron'

export class PlatformNotImplementedError extends Error {
  constructor(domain: string, method: string) {
    super(`[platform:${domain}] ${method} not implemented for this shell yet`)
    this.name = 'PlatformNotImplementedError'
  }
}
