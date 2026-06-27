declare global {
  /**
   * Legacy dynamic schema boundary for model params, request payloads, and
   * persisted plugin-like configuration. Keep dynamic access explicit by name
   * instead of scattering bare `any` through the codebase.
   */
  type DynamicValue = ReturnType<typeof JSON.parse>
  type DynamicValueMap = Record<string, DynamicValue>
}

export {}
