interface DropdownDisplayOption<T extends string | number | boolean> {
  label: string
  value: T
}

export function resolveDropdownDisplay<T extends string | number | boolean>(
  display: string | undefined,
  value: T | undefined,
  options: DropdownDisplayOption<T>[] | undefined,
): string {
  return display ?? options?.find((option) => option.value === value)?.label ?? String(value ?? '')
}
