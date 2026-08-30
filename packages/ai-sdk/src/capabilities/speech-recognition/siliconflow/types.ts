export interface SiliconFlowAsrModuleOptions {
  /** SiliconFlow API root. */
  apiBaseUrl?: string
  /** Local upload guard. Defaults to the documented 50 MB limit. */
  maxFileBytes?: number
}
