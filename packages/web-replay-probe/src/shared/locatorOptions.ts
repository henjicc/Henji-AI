/** DOM-free so Henji's main process can share it. */
export interface LocatorOptions {
  /** Attribute that names an element explicitly. Default `data-replay-id`. */
  idAttribute: string
  /** Attributes that name an action, checked in order. Default `['data-act']`. */
  actionAttributes: string[]
}
export const DEFAULT_LOCATOR_OPTIONS: LocatorOptions = { idAttribute: 'data-replay-id', actionAttributes: ['data-act'] }
