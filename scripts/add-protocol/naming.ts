/**
 * Shared naming convention helpers for the protocol onboarding pipeline.
 *
 * All generators need to convert between kebab-case protocol IDs and
 * various TypeScript/Rust naming conventions.
 */

/** kebab-case → PascalCase: "flash-trade" → "FlashTrade" */
export function pascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** kebab-case → camelCase: "flash-trade" → "flashTrade" */
export function camelCase(kebab: string): string {
  const parts = kebab.split("-");
  return (
    parts[0] +
    parts
      .slice(1)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("")
  );
}

/** kebab-case → UPPER_SNAKE: "flash-trade" → "FLASH_TRADE" */
export function upperSnake(kebab: string): string {
  return kebab.toUpperCase().replace(/-/g, "_");
}
