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

/** Display name → UPPER_SNAKE program constant: "Kamino Lending" → "KAMINO_LENDING_PROGRAM" */
export function programConstName(displayName: string): string {
  return displayName.replace(/\s+/g, "_").toUpperCase() + "_PROGRAM";
}

/** camelCase → UPPER_SNAKE: "maxAmount" → "MAX_AMOUNT" */
export function camelToUpper(camel: string): string {
  return camel.replace(/([A-Z])/g, "_$1").toUpperCase();
}

/** Build a category constant name: ("spending", "KAMINO") → "KAMINO_SPENDING_ACTIONS" */
export function categoryToConstName(category: string, upper: string): string {
  const catUpper = category.replace(/([A-Z])/g, "_$1").toUpperCase();
  return `${upper}_${catUpper}_ACTIONS`;
}
