/** Versioned, static-CSS theme contract for Tocyn consumers. */
export const TOCYN_THEME_CONTRACT_VERSION = '1';

export type TocynThemeMode = 'light' | 'dark';

export interface TocynThemeTokens {
  colorSurface: string;
  colorSurfacePanel: string;
  colorSurfaceMuted: string;
  colorDivider: string;
  colorText: string;
  colorTextMuted: string;
  colorFocus: string;
  colorSelected: string;
  colorCritical: string;
  colorQuiet: string;
  motionDurationFast: string;
  motionDurationNormal: string;
  motionDurationSlow: string;
  motionEasingStandard: string;
  targetMin: string;
  densityComfortable: string;
  typeScaleBody: string;
  typeLineHeightBody: string;
}

export type TocynThemeOverrides = Partial<TocynThemeTokens>;

/** Tenant branding is validated for both palettes before either is persisted. */
export type TocynTenantTheme = Readonly<{
  version: typeof TOCYN_THEME_CONTRACT_VERSION;
  light: TocynThemeOverrides;
  dark: TocynThemeOverrides;
}>;

export function parseTocynTenantTheme(value: unknown): TocynTenantTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid tenant theme');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !['version', 'light', 'dark'].includes(key)
      || !('value' in Object.getOwnPropertyDescriptor(value, key)!)) throw new TypeError('Invalid tenant theme field');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== TOCYN_THEME_CONTRACT_VERSION) throw new TypeError('Unsupported tenant theme version');
  const light = record.light ?? {};
  const dark = record.dark ?? {};
  // Null is malformed, rather than a request to discard a stored palette.
  if (record.light === null || record.dark === null) throw new TypeError('Invalid tenant palette');
  validateOverrides(light); validateOverrides(dark);
  resolveTocynTheme({ mode: 'light', tenant: light });
  resolveTocynTheme({ mode: 'dark', tenant: dark });
  return Object.freeze({ version: TOCYN_THEME_CONTRACT_VERSION,
    light: Object.freeze({ ...light }), dark: Object.freeze({ ...dark }) });
}

export interface TocynThemeInput {
  mode?: TocynThemeMode;
  tenant?: TocynThemeOverrides;
  instance?: TocynThemeOverrides;
}

export interface ResolvedTocynTheme {
  version: typeof TOCYN_THEME_CONTRACT_VERSION;
  mode: TocynThemeMode;
  tokens: TocynThemeTokens;
  variables: Record<`--tocyn-${string}`, string>;
}

const LIGHT_DEFAULTS: TocynThemeTokens = {
  colorSurface: '#ffffff', colorSurfacePanel: '#f8fafc', colorSurfaceMuted: '#f1f5f9',
  colorDivider: '#cbd5e1', colorText: '#0f172a', colorTextMuted: '#475569',
  colorFocus: '#1d4ed8', colorSelected: '#dbeafe', colorCritical: '#b91c1c', colorQuiet: '#475569',
  motionDurationFast: '120ms', motionDurationNormal: '180ms', motionDurationSlow: '240ms',
  motionEasingStandard: 'cubic-bezier(0.2, 0, 0, 1)', targetMin: '44px', densityComfortable: '1rem',
  typeScaleBody: '1rem', typeLineHeightBody: '1.5',
};

const DARK_DEFAULTS: TocynThemeTokens = {
  ...LIGHT_DEFAULTS, colorSurface: '#0f172a', colorSurfacePanel: '#1e293b', colorSurfaceMuted: '#334155',
  colorDivider: '#475569', colorText: '#f8fafc', colorTextMuted: '#cbd5e1', colorFocus: '#93c5fd',
  colorSelected: '#1e3a8a', colorCritical: '#fca5a5', colorQuiet: '#cbd5e1',
};

const TOKEN_NAMES: Record<keyof TocynThemeTokens, `--tocyn-${string}`> = {
  colorSurface: '--tocyn-color-surface', colorSurfacePanel: '--tocyn-color-surface-panel', colorSurfaceMuted: '--tocyn-color-surface-muted',
  colorDivider: '--tocyn-color-divider', colorText: '--tocyn-color-text', colorTextMuted: '--tocyn-color-text-muted',
  colorFocus: '--tocyn-color-focus', colorSelected: '--tocyn-color-selected', colorCritical: '--tocyn-color-critical', colorQuiet: '--tocyn-color-quiet',
  motionDurationFast: '--tocyn-motion-duration-fast', motionDurationNormal: '--tocyn-motion-duration-normal', motionDurationSlow: '--tocyn-motion-duration-slow',
  motionEasingStandard: '--tocyn-motion-easing-standard', targetMin: '--tocyn-target-min', densityComfortable: '--tocyn-density-comfortable',
  typeScaleBody: '--tocyn-type-scale-body', typeLineHeightBody: '--tocyn-type-line-height-body',
};

// Deliberately conservative: CSS functions, URLs, delimiters and custom syntax are rejected.
const COLOR_KEYS = ['colorSurface', 'colorSurfacePanel', 'colorSurfaceMuted', 'colorDivider', 'colorText', 'colorTextMuted', 'colorFocus', 'colorSelected', 'colorCritical', 'colorQuiet'] as const;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const NUMBER = /^(\d+(?:\.\d+)?)$/;
const DURATION = /^(\d+(?:\.\d+)?)(ms|s)$/i;
function lengthBetween(value: string, pxMin: number, pxMax: number, remMin?: number, remMax?: number): boolean {
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value);
  if (!match) return false;
  const amount = Number(match[1]);
  return match[2] === 'px' ? amount >= pxMin && amount <= pxMax
    : remMin !== undefined && remMax !== undefined && amount >= remMin && amount <= remMax;
}
function milliseconds(value: string): number {
  const match = DURATION.exec(value);
  return match ? Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1) : NaN;
}
function validEasing(value: string): boolean {
  if (/^(linear|ease|ease-in|ease-out|ease-in-out)$/.test(value)) return true;
  const match = /^cubic-bezier\(([^()]+)\)$/.exec(value);
  if (!match) return false;
  const values = match[1].split(',').map(item => item.trim());
  return values.length === 4 && values.every(item => NUMBER.test(item) && Number(item) >= 0 && Number(item) <= 1);
}
function hexRgb(value: string): [number, number, number] { const hex = value.length === 4 ? value.slice(1).split('').map(char => char + char).join('') : value.slice(1); return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]; }
function luminance(value: string): number { return hexRgb(value).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0); }
function contrast(a: string, b: string): number { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); }
function validateOverrides(overrides: unknown): asserts overrides is TocynThemeOverrides {
  if (overrides === undefined) return;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('Invalid Tocyn theme overrides');
  const prototype = Object.getPrototypeOf(overrides);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError('Theme overrides must be a plain record');
  for (const name of Reflect.ownKeys(overrides)) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(TOKEN_NAMES, name)) throw new TypeError('Unknown Tocyn theme token');
    if (!('value' in Object.getOwnPropertyDescriptor(overrides, name)!)) throw new TypeError('Theme accessors are not supported');
  }
}

export function resolveTocynTheme(input: TocynThemeInput = {}): ResolvedTocynTheme {
  const mode = input.mode ?? 'light';
  if (mode !== 'light' && mode !== 'dark') throw new TypeError('Invalid Tocyn theme mode');
  validateOverrides(input.tenant); validateOverrides(input.instance);
  const tokens = { ...(mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS), ...(input.tenant ?? {}), ...(input.instance ?? {}) };
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value !== 'string' || value.length > 80) throw new TypeError(`Invalid Tocyn theme value for ${name}`);
    const valid = COLOR_KEYS.includes(name as typeof COLOR_KEYS[number]) ? COLOR.test(value)
      : name.startsWith('motionDuration') ? milliseconds(value) >= 0 && milliseconds(value) <= 500
      : name === 'motionEasingStandard' ? validEasing(value)
      : name === 'targetMin' ? lengthBetween(value, 44, 96)
      : name === 'typeLineHeightBody' ? NUMBER.test(value) && Number(value) >= 1.5 && Number(value) <= 2.5
      : name === 'densityComfortable' ? lengthBetween(value, 8, 32, 0.5, 2)
      : name === 'typeScaleBody' ? lengthBetween(value, 16, 32, 1, 2) : false;
    if (!valid) {
      throw new TypeError(`Invalid Tocyn theme value for ${name}`);
    }
  }
  for (const surface of [tokens.colorSurface, tokens.colorSurfacePanel, tokens.colorSurfaceMuted, tokens.colorSelected]) {
    if ([tokens.colorText, tokens.colorTextMuted, tokens.colorCritical, tokens.colorQuiet].some(text => contrast(text, surface) < 4.5)
      || contrast(tokens.colorFocus, surface) < 3) throw new TypeError('Tocyn theme colours do not meet contrast requirements');
  }
  const variables = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [TOKEN_NAMES[key as keyof TocynThemeTokens], value])) as ResolvedTocynTheme['variables'];
  return Object.freeze({ version: TOCYN_THEME_CONTRACT_VERSION, mode, tokens: Object.freeze(tokens), variables: Object.freeze(variables) });
}

/** Returns the contract's properties for removal when an override is cleared. */
export function tocynThemePropertiesToReset(overrides: TocynThemeOverrides): string[] {
  validateOverrides(overrides);
  return Object.keys(overrides).filter(key => Object.prototype.hasOwnProperty.call(TOKEN_NAMES, key)).map(key => TOKEN_NAMES[key as keyof TocynThemeTokens]);
}
