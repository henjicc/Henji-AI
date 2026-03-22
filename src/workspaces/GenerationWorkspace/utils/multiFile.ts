const MULTI_SEPARATOR = '|||'

export function splitMulti(value: string): string[] {
  return value.includes(MULTI_SEPARATOR) ? value.split(MULTI_SEPARATOR) : [value]
}

export function joinMulti(values: string[]): string {
  return values.join(MULTI_SEPARATOR)
}

