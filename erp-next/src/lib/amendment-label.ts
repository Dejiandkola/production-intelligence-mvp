export function amendmentLabel(ordinal: number | null | undefined): string {
  return ordinal == null || ordinal === 0 ? 'Amendment' : `Additional Amendment ${ordinal}`
}
