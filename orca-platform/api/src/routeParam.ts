/** Express 5 types route params as `string | string[]` (repeating-param support); our routes never repeat. */
export function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}
