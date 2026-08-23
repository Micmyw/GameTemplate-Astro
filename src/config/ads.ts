export const AD_SLOT_IDS = [
  "home-after-featured",
  "game-before-player",
  "game-after-content",
  "category-after-grid",
] as const;

export type AdSlotId = (typeof AD_SLOT_IDS)[number];
export type AdsMode = "disabled" | "placeholder";

type AdsEnvironment = {
  PUBLIC_ADS_MODE?: string;
};

export type AdsConfig = {
  mode: AdsMode;
  slots: Readonly<Record<AdSlotId, boolean>>;
};

export const createAdsConfig = (
  environment: AdsEnvironment = {},
): AdsConfig => {
  const mode = environment.PUBLIC_ADS_MODE?.trim() || "disabled";
  if (mode !== "disabled" && mode !== "placeholder") {
    throw new Error(
      `PUBLIC_ADS_MODE must be "disabled" or "placeholder"; received ${JSON.stringify(mode)}`,
    );
  }

  const enabled = mode === "placeholder";
  return {
    mode,
    slots: {
      "home-after-featured": enabled,
      "game-before-player": enabled,
      "game-after-content": enabled,
      "category-after-grid": enabled,
    },
  };
};

export const ADS = createAdsConfig({
  PUBLIC_ADS_MODE: import.meta.env?.PUBLIC_ADS_MODE,
});

export const isAdSlotEnabled = (
  slot: AdSlotId,
  config: AdsConfig = ADS,
): boolean => config.slots[slot];
