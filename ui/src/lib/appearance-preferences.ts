import { getConfig } from "@/lib/config";
import { gradientThemes,type GradientThemeId } from "@/lib/gradient-themes";

export const FONT_SIZES = [
  { id: "small",label: "Small",size: "14px" },
  { id: "medium",label: "Medium",size: "16px" },
  { id: "large",label: "Large",size: "18px" },
  { id: "x-large",label: "Extra Large",size: "20px" },
] as const;

export const FONT_FAMILIES = [
  { id: "inter",label: "Inter",description: "Clean and modern" },
  { id: "source-sans",label: "Source Sans",description: "Optimized for readability" },
  { id: "ibm-plex",label: "IBM Plex",description: "Technical and structured" },
  { id: "system",label: "System",description: "Use your device font" },
] as const;

export const COLOR_THEMES = [
  { id: "system",label: "System",description: "Match your device" },
  { id: "light",label: "Light",description: "Balanced tonal surfaces and brand color" },
  { id: "legacy-light",label: "Legacy Light",description: "Original bright neutral palette" },
  { id: "dark",label: "Dark",description: "Easy on the eyes" },
  { id: "midnight",label: "Midnight",description: "Pure black for OLED" },
  { id: "nord",label: "Nord",description: "Muted arctic colors" },
  { id: "tokyo",label: "Tokyo Night",description: "Vibrant purple" },
  { id: "cyberpunk",label: "Cyberpunk",description: "Neon pink and cyan" },
  { id: "tron",label: "Tron",description: "Digital cyan glow" },
  { id: "matrix",label: "Matrix",description: "Green phosphor" },
] as const;

export type FontSize = typeof FONT_SIZES[number]["id"];
export type FontFamily = typeof FONT_FAMILIES[number]["id"];
export type ColorTheme = typeof COLOR_THEMES[number]["id"];
export type GradientTheme = GradientThemeId;
export type AppearancePreferenceKey =
  | "font_size"
  | "font_family"
  | "gradient_theme"
  | "theme";

export interface AppearancePreferences {
  fontFamily: FontFamily;
  fontSize: FontSize;
  gradientTheme: GradientTheme;
  theme: ColorTheme;
}

export type AppearanceInteractionSnapshot = Record<keyof AppearancePreferences,number>;

const appearanceInteractionVersions: AppearanceInteractionSnapshot = {
  fontFamily: 0,
  fontSize: 0,
  gradientTheme: 0,
  theme: 0,
};

const STORAGE_KEYS = {
  fontFamily: "caipe-font-family",
  fontSize: "caipe-font-size",
  gradientTheme: "caipe-gradient-theme",
} as const;

function isOption<Value extends string>(
  value: unknown,
  options: ReadonlyArray<{ id: Value }>,
): value is Value {
  return typeof value === "string" && options.some((option) => option.id === value);
}

function hslComponents(color: string): string | null {
  const match = color.match(
    /^hsl\(\s*([-+]?\d*\.?\d+)\s*[, ]\s*([-+]?\d*\.?\d+)%\s*[, /]\s*([-+]?\d*\.?\d+)%/i,
  );
  return match ? `${match[1]} ${match[2]}% ${match[3]}%` : null;
}

/**
 * Whatever reads on the accent: near-black or white, whichever is further from
 * it.
 *
 * The accent is a user choice, so the colour that sits on top of it cannot be
 * fixed per theme. White fails WCAG 1.4.3 on most of the presets — 2.5:1 on
 * Teal, 1.7:1 on Matrix — and near-black fails on the two darkest, Minimal and
 * Ember. Picking per accent keeps every preset at 4.9:1 or better.
 */
function readableOn(components: string): string {
  const [h, s, l] = components
    .split(" ")
    .map((part) => Number.parseFloat(part));
  if ([h, s, l].some(Number.isNaN)) return "0 0% 100%";

  // HSL to relative luminance, per WCAG's definition.
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector].map((v) => v + m);
  const linear = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  return onBlack >= onWhite ? "0 0% 4%" : "0 0% 100%";
}

export function getDefaultAppearancePreferences(): AppearancePreferences {
  const configuredTheme = getConfig("defaultTheme");
  return {
    fontFamily: getConfig("defaultFontFamily") as FontFamily,
    fontSize: getConfig("defaultFontSize") as FontSize,
    gradientTheme: getConfig("defaultGradientTheme") as GradientTheme,
    theme: isOption(configuredTheme,COLOR_THEMES) ? configuredTheme : "system",
  };
}

export function readCachedAppearancePreferences(): Partial<AppearancePreferences> {
  if (typeof window === "undefined") return {};

  const fontFamily = localStorage.getItem(STORAGE_KEYS.fontFamily);
  const fontSize = localStorage.getItem(STORAGE_KEYS.fontSize);
  const gradientTheme = localStorage.getItem(STORAGE_KEYS.gradientTheme);
  const theme = localStorage.getItem("theme");
  return {
    ...(isOption(fontFamily,FONT_FAMILIES) ? { fontFamily } : {}),
    ...(isOption(fontSize,FONT_SIZES) ? { fontSize } : {}),
    ...(isOption(gradientTheme,gradientThemes) ? { gradientTheme } : {}),
    ...(isOption(theme,COLOR_THEMES) ? { theme } : {}),
  };
}

export function markAppearanceInteraction(field: keyof AppearancePreferences): void {
  appearanceInteractionVersions[field] += 1;
}

export function snapshotAppearanceInteractions(): AppearanceInteractionSnapshot {
  return { ...appearanceInteractionVersions };
}

/** Merge only server fields the user has not changed since the request began. */
export function mergeUnchangedServerAppearance(
  current: AppearancePreferences,
  server: Partial<AppearancePreferences>,
  snapshot: AppearanceInteractionSnapshot,
): AppearancePreferences {
  return {
    fontFamily:
      appearanceInteractionVersions.fontFamily === snapshot.fontFamily && server.fontFamily
        ? server.fontFamily
        : current.fontFamily,
    fontSize:
      appearanceInteractionVersions.fontSize === snapshot.fontSize && server.fontSize
        ? server.fontSize
        : current.fontSize,
    gradientTheme:
      appearanceInteractionVersions.gradientTheme === snapshot.gradientTheme && server.gradientTheme
        ? server.gradientTheme
        : current.gradientTheme,
    theme:
      appearanceInteractionVersions.theme === snapshot.theme && server.theme
        ? server.theme
        : current.theme,
  };
}

export function normalizeServerAppearancePreferences(
  preferences: Record<string,unknown> | undefined,
): Partial<AppearancePreferences> {
  if (!preferences) return {};
  return {
    ...(isOption(preferences.font_family,FONT_FAMILIES)
      ? { fontFamily: preferences.font_family }
      : {}),
    ...(isOption(preferences.font_size,FONT_SIZES)
      ? { fontSize: preferences.font_size }
      : {}),
    ...(isOption(preferences.gradient_theme,gradientThemes)
      ? { gradientTheme: preferences.gradient_theme }
      : {}),
    ...(isOption(preferences.theme,COLOR_THEMES)
      ? { theme: preferences.theme }
      : {}),
  };
}

export function applyFontFamily(value: FontFamily): void {
  document.body.setAttribute("data-font-family",value);
  localStorage.setItem(STORAGE_KEYS.fontFamily,value);
}

export function applyFontSize(value: FontSize): void {
  document.body.setAttribute("data-font-size",value);
  localStorage.setItem(STORAGE_KEYS.fontSize,value);
}

export function applyGradientTheme(value: GradientTheme): void {
  const selected = gradientThemes.find((theme) => theme.id === value);
  if (!selected) return;
  const root = document.documentElement;
  root.style.setProperty("--gradient-from",selected.from);
  root.style.setProperty("--gradient-to",selected.to);

  // Primary controls are part of the selected accent system, so buttons,
  // focus rings, selections, and active settings choices use the same hue.
  const from = hslComponents(selected.from);
  const to = hslComponents(selected.to);
  if (from) {
    root.style.setProperty("--primary",from);
    // Set alongside --primary, never separately: anything drawn on the accent
    // reads it, so the two have to move together.
    root.style.setProperty("--primary-foreground",readableOn(from));
    root.style.setProperty("--ring",from);
    root.style.setProperty("--gradient-start",from);
    root.style.setProperty("--gradient-mid",from);
  }
  if (to) root.style.setProperty("--gradient-end",to);

  root.setAttribute("data-gradient-theme",value);
  localStorage.setItem(STORAGE_KEYS.gradientTheme,value);
}

export function applyColorTheme(value: ColorTheme): void {
  const resolvedTheme = value === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : value;
  const root = document.documentElement;
  root.setAttribute("data-theme",resolvedTheme);
  // Palette CSS owns color-scheme for custom light and dark themes. Clear
  // inline values left by older builds so native controls use that palette.
  root.style.removeProperty("color-scheme");
  localStorage.setItem("theme",value);
}

export function applyCachedAppearance(preferences: AppearancePreferences): void {
  applyFontFamily(preferences.fontFamily);
  applyFontSize(preferences.fontSize);
  applyGradientTheme(preferences.gradientTheme);
  applyColorTheme(preferences.theme);
}
