export type PolicyPreset =
  | "conservative"
  | "moderate"
  | "aggressive"
  | "custom";

export interface PresetConfig {
  dailyCapUsd: number;
  maxSlippageBps: number;
  protocols: ("jupiter" | "flash-trade" | "all")[];
}

export const PRESETS: Record<Exclude<PolicyPreset, "custom">, PresetConfig> = {
  conservative: {
    dailyCapUsd: 100,
    maxSlippageBps: 100,
    protocols: ["jupiter"],
  },
  moderate: {
    dailyCapUsd: 500,
    maxSlippageBps: 300,
    protocols: ["all"],
  },
  aggressive: {
    dailyCapUsd: 2000,
    maxSlippageBps: 500,
    protocols: ["all"],
  },
};

export const PRESET_LABELS: Record<PolicyPreset, string> = {
  conservative: "Conservative — $100/day, Jupiter only, 1% slippage",
  moderate: "Moderate — $500/day, all protocols, 3% slippage",
  aggressive: "Aggressive — $2K/day, all protocols, 5% slippage",
  custom: "Custom — configure manually",
};

export function getPresetConfig(preset: PolicyPreset): PresetConfig | null {
  if (preset === "custom") return null;
  return PRESETS[preset];
}
