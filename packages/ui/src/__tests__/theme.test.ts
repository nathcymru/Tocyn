import { describe, expect, it } from 'vitest';
import { parseTocynTenantTheme, resolveTocynTheme, tocynThemePropertiesToReset, TOCYN_THEME_CONTRACT_VERSION } from '../theme';

describe('Tocyn theme contract', () => {
  it('validates independent stored palettes and copies the accepted values', () => {
    const input = { version: '1', light: { colorSurface: '#ffffff' }, dark: { colorSurface: '#0f172a' } };
    const parsed = parseTocynTenantTheme(input);
    input.dark.colorSurface = '#ffffff';
    expect(parsed.dark.colorSurface).toBe('#0f172a');
    expect(Object.isFrozen(parsed.dark)).toBe(true);
    expect(parseTocynTenantTheme({ version: '1' })).toEqual({ version: '1', light: {}, dark: {} });
    expect(() => parseTocynTenantTheme({ ...input, dark: { colorText: '#0f172a' } })).toThrow();
  });

  it('rejects unsupported stored shapes and accessors without invoking them', () => {
    for (const value of [null, [], { version: '2' }, { version: '1', light: null },
      { version: '1', tenant: {} }, { version: '1', dark: { targetMin: '1px' } }]) {
      expect(() => parseTocynTenantTheme(value)).toThrow();
    }
    let invoked = false;
    const value = { version: '1', get dark() { invoked = true; return {}; } };
    expect(() => parseTocynTenantTheme(value)).toThrow();
    expect(invoked).toBe(false);
  });

  it('resolves fallback, tenant, then instance values with a version', () => {
    const theme = resolveTocynTheme({ mode: 'dark', tenant: { targetMin: '48px' }, instance: { targetMin: '52px' } });
    expect(theme.version).toBe(TOCYN_THEME_CONTRACT_VERSION);
    expect(theme.tokens.colorSelected).toBe('#0d2847');
    expect(theme.tokens.colorInverse).toBe('#edeef0');
    expect(theme.tokens.colorText).toBe('#edeef0');
    expect(theme.variables['--tocyn-color-selected']).toBe('#0d2847');
    expect(theme.variables['--tocyn-color-inverse']).toBe('#edeef0');
    expect(theme.tokens.targetMin).toBe('52px');
    expect(resolveTocynTheme({ tenant: { targetMin: '48px' } }).tokens.targetMin).toBe('48px');
    expect(resolveTocynTheme().tokens.targetMin).toBe('44px');
  });

  it('rejects CSS injection and unknown values, while exposing reset properties', () => {
    expect(() => resolveTocynTheme({ tenant: { colorSurface: 'url(https://evil.test)' } })).toThrow(TypeError);
    expect(() => resolveTocynTheme({ tenant: { colorSurface: '#fff; color:red' } })).toThrow(TypeError);
    expect(() => resolveTocynTheme({ instance: { targetMin: '1rem' } })).toThrow(TypeError);
    expect(() => resolveTocynTheme({ mode: 'sepia' } as never)).toThrow(TypeError);
    expect(() => resolveTocynTheme({ tenant: { colorSurface: '#fffff' } })).toThrow(TypeError);
    expect(() => resolveTocynTheme({ tenant: { motionDurationFast: '#fff' } })).toThrow(TypeError);
    expect(() => resolveTocynTheme({ tenant: { colorText: '#ffffff' } })).toThrow(TypeError);
    expect(() => resolveTocynTheme({ tenant: { madeUp: '#fff' } } as never)).toThrow(TypeError);
    const inherited = Object.create({ madeUp: '#fff' }); inherited.colorSurface = '#fff';
    expect(() => resolveTocynTheme({ tenant: inherited })).toThrow(TypeError);
    expect(tocynThemePropertiesToReset({ colorSurface: '#fff', motionDurationFast: '1ms' })).toEqual(['--tocyn-color-surface', '--tocyn-motion-duration-fast']);
    expect(() => tocynThemePropertiesToReset({ colorSurface: '#fff', nope: '#fff' } as never)).toThrow(TypeError);
  });

  it('validates units, duration conversion and every supported contrast surface', () => {
    for (const tenant of [
      { typeScaleBody: '0.75px' }, { typeScaleBody: '1vw' }, { typeLineHeightBody: '1.2' },
      { densityComfortable: '1px' }, { motionDurationSlow: '5000s' }, { motionDurationFast: '0.501s' },
      { motionEasingStandard: 'cubic-bezier(9, 0, 0, 1)' }, { colorSurfacePanel: '#0f172a' },
      { colorSurfaceMuted: '#0f172a' }, { colorSelected: '#0f172a' }, { targetMin: '43.99px' },
    ]) expect(() => resolveTocynTheme({ tenant })).toThrow(TypeError);
    expect(resolveTocynTheme({ tenant: { motionDurationSlow: '0.5s', typeScaleBody: '20px' } }).tokens.motionDurationSlow).toBe('0.5s');
    const accessor = { get colorText(): string { throw new Error('Accessor must not run'); } };
    expect(() => resolveTocynTheme({ tenant: accessor })).toThrow(TypeError);
    expect(Object.isFrozen(resolveTocynTheme().variables)).toBe(true);
  });

  it('requires at least 4.5:1 text contrast on every content surface', () => {
    // #6e6e6e reaches only 4.48:1 against the muted light surface.
    expect(() => resolveTocynTheme({ tenant: { colorTextMuted: '#6e6e6e' } })).toThrow(TypeError);
    expect(resolveTocynTheme({ tenant: { colorTextMuted: '#6d6d6d' } }).tokens.colorTextMuted).toBe('#6d6d6d');
  });
});
