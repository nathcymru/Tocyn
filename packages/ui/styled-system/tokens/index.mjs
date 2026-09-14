const tokens = {
  "aspectRatios.square": {
    "value": "1 / 1",
    "variable": "var(--tocyn-aspect-ratios-square)"
  },
  "aspectRatios.landscape": {
    "value": "4 / 3",
    "variable": "var(--tocyn-aspect-ratios-landscape)"
  },
  "aspectRatios.portrait": {
    "value": "3 / 4",
    "variable": "var(--tocyn-aspect-ratios-portrait)"
  },
  "aspectRatios.wide": {
    "value": "16 / 9",
    "variable": "var(--tocyn-aspect-ratios-wide)"
  },
  "aspectRatios.ultrawide": {
    "value": "18 / 5",
    "variable": "var(--tocyn-aspect-ratios-ultrawide)"
  },
  "aspectRatios.golden": {
    "value": "1.618 / 1",
    "variable": "var(--tocyn-aspect-ratios-golden)"
  },
  "borders.none": {
    "value": "none",
    "variable": "var(--tocyn-borders-none)"
  },
  "easings.default": {
    "value": "cubic-bezier(0.4, 0, 0.2, 1)",
    "variable": "var(--tocyn-easings-default)"
  },
  "easings.linear": {
    "value": "linear",
    "variable": "var(--tocyn-easings-linear)"
  },
  "easings.in": {
    "value": "cubic-bezier(0.4, 0, 1, 1)",
    "variable": "var(--tocyn-easings-in)"
  },
  "easings.out": {
    "value": "cubic-bezier(0, 0, 0.2, 1)",
    "variable": "var(--tocyn-easings-out)"
  },
  "easings.in-out": {
    "value": "cubic-bezier(0.4, 0, 0.2, 1)",
    "variable": "var(--tocyn-easings-in-out)"
  },
  "durations.fastest": {
    "value": "50ms",
    "variable": "var(--tocyn-durations-fastest)"
  },
  "durations.faster": {
    "value": "100ms",
    "variable": "var(--tocyn-durations-faster)"
  },
  "durations.fast": {
    "value": "150ms",
    "variable": "var(--tocyn-durations-fast)"
  },
  "durations.normal": {
    "value": "200ms",
    "variable": "var(--tocyn-durations-normal)"
  },
  "durations.slow": {
    "value": "300ms",
    "variable": "var(--tocyn-durations-slow)"
  },
  "durations.slower": {
    "value": "400ms",
    "variable": "var(--tocyn-durations-slower)"
  },
  "durations.slowest": {
    "value": "500ms",
    "variable": "var(--tocyn-durations-slowest)"
  },
  "radii.xs": {
    "value": "0.125rem",
    "variable": "var(--tocyn-radii-xs)"
  },
  "radii.sm": {
    "value": "0.25rem",
    "variable": "var(--tocyn-radii-sm)"
  },
  "radii.md": {
    "value": "0.375rem",
    "variable": "var(--tocyn-radii-md)"
  },
  "radii.lg": {
    "value": "0.5rem",
    "variable": "var(--tocyn-radii-lg)"
  },
  "radii.xl": {
    "value": "0.75rem",
    "variable": "var(--tocyn-radii-xl)"
  },
  "radii.2xl": {
    "value": "1rem",
    "variable": "var(--tocyn-radii-2xl)"
  },
  "radii.3xl": {
    "value": "1.5rem",
    "variable": "var(--tocyn-radii-3xl)"
  },
  "radii.4xl": {
    "value": "2rem",
    "variable": "var(--tocyn-radii-4xl)"
  },
  "radii.full": {
    "value": "9999px",
    "variable": "var(--tocyn-radii-full)"
  },
  "fontWeights.thin": {
    "value": "100",
    "variable": "var(--tocyn-font-weights-thin)"
  },
  "fontWeights.extralight": {
    "value": "200",
    "variable": "var(--tocyn-font-weights-extralight)"
  },
  "fontWeights.light": {
    "value": "300",
    "variable": "var(--tocyn-font-weights-light)"
  },
  "fontWeights.normal": {
    "value": "400",
    "variable": "var(--tocyn-font-weights-normal)"
  },
  "fontWeights.medium": {
    "value": "500",
    "variable": "var(--tocyn-font-weights-medium)"
  },
  "fontWeights.semibold": {
    "value": "600",
    "variable": "var(--tocyn-font-weights-semibold)"
  },
  "fontWeights.bold": {
    "value": "700",
    "variable": "var(--tocyn-font-weights-bold)"
  },
  "fontWeights.extrabold": {
    "value": "800",
    "variable": "var(--tocyn-font-weights-extrabold)"
  },
  "fontWeights.black": {
    "value": "900",
    "variable": "var(--tocyn-font-weights-black)"
  },
  "lineHeights.none": {
    "value": "1",
    "variable": "var(--tocyn-line-heights-none)"
  },
  "lineHeights.tight": {
    "value": "1.25",
    "variable": "var(--tocyn-line-heights-tight)"
  },
  "lineHeights.snug": {
    "value": "1.375",
    "variable": "var(--tocyn-line-heights-snug)"
  },
  "lineHeights.normal": {
    "value": "1.5",
    "variable": "var(--tocyn-line-heights-normal)"
  },
  "lineHeights.relaxed": {
    "value": "1.625",
    "variable": "var(--tocyn-line-heights-relaxed)"
  },
  "lineHeights.loose": {
    "value": "2",
    "variable": "var(--tocyn-line-heights-loose)"
  },
  "fonts.sans": {
    "value": "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, \"Noto Sans\", sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\"",
    "variable": "var(--tocyn-fonts-sans)"
  },
  "fonts.serif": {
    "value": "ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif",
    "variable": "var(--tocyn-fonts-serif)"
  },
  "fonts.mono": {
    "value": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    "variable": "var(--tocyn-fonts-mono)"
  },
  "letterSpacings.tighter": {
    "value": "-0.05em",
    "variable": "var(--tocyn-letter-spacings-tighter)"
  },
  "letterSpacings.tight": {
    "value": "-0.025em",
    "variable": "var(--tocyn-letter-spacings-tight)"
  },
  "letterSpacings.normal": {
    "value": "0em",
    "variable": "var(--tocyn-letter-spacings-normal)"
  },
  "letterSpacings.wide": {
    "value": "0.025em",
    "variable": "var(--tocyn-letter-spacings-wide)"
  },
  "letterSpacings.wider": {
    "value": "0.05em",
    "variable": "var(--tocyn-letter-spacings-wider)"
  },
  "letterSpacings.widest": {
    "value": "0.1em",
    "variable": "var(--tocyn-letter-spacings-widest)"
  },
  "fontSizes.2xs": {
    "value": "0.5rem",
    "variable": "var(--tocyn-font-sizes-2xs)"
  },
  "fontSizes.xs": {
    "value": "0.75rem",
    "variable": "var(--tocyn-font-sizes-xs)"
  },
  "fontSizes.sm": {
    "value": "0.875rem",
    "variable": "var(--tocyn-font-sizes-sm)"
  },
  "fontSizes.md": {
    "value": "1rem",
    "variable": "var(--tocyn-font-sizes-md)"
  },
  "fontSizes.lg": {
    "value": "1.125rem",
    "variable": "var(--tocyn-font-sizes-lg)"
  },
  "fontSizes.xl": {
    "value": "1.25rem",
    "variable": "var(--tocyn-font-sizes-xl)"
  },
  "fontSizes.2xl": {
    "value": "1.5rem",
    "variable": "var(--tocyn-font-sizes-2xl)"
  },
  "fontSizes.3xl": {
    "value": "1.875rem",
    "variable": "var(--tocyn-font-sizes-3xl)"
  },
  "fontSizes.4xl": {
    "value": "2.25rem",
    "variable": "var(--tocyn-font-sizes-4xl)"
  },
  "fontSizes.5xl": {
    "value": "3rem",
    "variable": "var(--tocyn-font-sizes-5xl)"
  },
  "fontSizes.6xl": {
    "value": "3.75rem",
    "variable": "var(--tocyn-font-sizes-6xl)"
  },
  "fontSizes.7xl": {
    "value": "4.5rem",
    "variable": "var(--tocyn-font-sizes-7xl)"
  },
  "fontSizes.8xl": {
    "value": "6rem",
    "variable": "var(--tocyn-font-sizes-8xl)"
  },
  "fontSizes.9xl": {
    "value": "8rem",
    "variable": "var(--tocyn-font-sizes-9xl)"
  },
  "shadows.2xs": {
    "value": "0 1px rgb(0 0 0 / 0.05)",
    "variable": "var(--tocyn-shadows-2xs)"
  },
  "shadows.xs": {
    "value": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    "variable": "var(--tocyn-shadows-xs)"
  },
  "shadows.sm": {
    "value": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    "variable": "var(--tocyn-shadows-sm)"
  },
  "shadows.md": {
    "value": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    "variable": "var(--tocyn-shadows-md)"
  },
  "shadows.lg": {
    "value": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    "variable": "var(--tocyn-shadows-lg)"
  },
  "shadows.xl": {
    "value": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    "variable": "var(--tocyn-shadows-xl)"
  },
  "shadows.2xl": {
    "value": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
    "variable": "var(--tocyn-shadows-2xl)"
  },
  "shadows.inset-2xs": {
    "value": "inset 0 1px rgb(0 0 0 / 0.05)",
    "variable": "var(--tocyn-shadows-inset-2xs)"
  },
  "shadows.inset-xs": {
    "value": "inset 0 1px 1px rgb(0 0 0 / 0.05)",
    "variable": "var(--tocyn-shadows-inset-xs)"
  },
  "shadows.inset-sm": {
    "value": "inset 0 2px 4px rgb(0 0 0 / 0.05)",
    "variable": "var(--tocyn-shadows-inset-sm)"
  },
  "colors.current": {
    "value": "currentColor",
    "variable": "var(--tocyn-colors-current)"
  },
  "colors.black": {
    "value": "#000",
    "variable": "var(--tocyn-colors-black)"
  },
  "colors.white": {
    "value": "#fff",
    "variable": "var(--tocyn-colors-white)"
  },
  "colors.transparent": {
    "value": "rgb(0 0 0 / 0)",
    "variable": "var(--tocyn-colors-transparent)"
  },
  "colors.rose.50": {
    "value": "#fff1f2",
    "variable": "var(--tocyn-colors-rose-50)"
  },
  "colors.rose.100": {
    "value": "#ffe4e6",
    "variable": "var(--tocyn-colors-rose-100)"
  },
  "colors.rose.200": {
    "value": "#fecdd3",
    "variable": "var(--tocyn-colors-rose-200)"
  },
  "colors.rose.300": {
    "value": "#fda4af",
    "variable": "var(--tocyn-colors-rose-300)"
  },
  "colors.rose.400": {
    "value": "#fb7185",
    "variable": "var(--tocyn-colors-rose-400)"
  },
  "colors.rose.500": {
    "value": "#f43f5e",
    "variable": "var(--tocyn-colors-rose-500)"
  },
  "colors.rose.600": {
    "value": "#e11d48",
    "variable": "var(--tocyn-colors-rose-600)"
  },
  "colors.rose.700": {
    "value": "#be123c",
    "variable": "var(--tocyn-colors-rose-700)"
  },
  "colors.rose.800": {
    "value": "#9f1239",
    "variable": "var(--tocyn-colors-rose-800)"
  },
  "colors.rose.900": {
    "value": "#881337",
    "variable": "var(--tocyn-colors-rose-900)"
  },
  "colors.rose.950": {
    "value": "#4c0519",
    "variable": "var(--tocyn-colors-rose-950)"
  },
  "colors.pink.50": {
    "value": "#fdf2f8",
    "variable": "var(--tocyn-colors-pink-50)"
  },
  "colors.pink.100": {
    "value": "#fce7f3",
    "variable": "var(--tocyn-colors-pink-100)"
  },
  "colors.pink.200": {
    "value": "#fbcfe8",
    "variable": "var(--tocyn-colors-pink-200)"
  },
  "colors.pink.300": {
    "value": "#f9a8d4",
    "variable": "var(--tocyn-colors-pink-300)"
  },
  "colors.pink.400": {
    "value": "#f472b6",
    "variable": "var(--tocyn-colors-pink-400)"
  },
  "colors.pink.500": {
    "value": "#ec4899",
    "variable": "var(--tocyn-colors-pink-500)"
  },
  "colors.pink.600": {
    "value": "#db2777",
    "variable": "var(--tocyn-colors-pink-600)"
  },
  "colors.pink.700": {
    "value": "#be185d",
    "variable": "var(--tocyn-colors-pink-700)"
  },
  "colors.pink.800": {
    "value": "#9d174d",
    "variable": "var(--tocyn-colors-pink-800)"
  },
  "colors.pink.900": {
    "value": "#831843",
    "variable": "var(--tocyn-colors-pink-900)"
  },
  "colors.pink.950": {
    "value": "#500724",
    "variable": "var(--tocyn-colors-pink-950)"
  },
  "colors.fuchsia.50": {
    "value": "#fdf4ff",
    "variable": "var(--tocyn-colors-fuchsia-50)"
  },
  "colors.fuchsia.100": {
    "value": "#fae8ff",
    "variable": "var(--tocyn-colors-fuchsia-100)"
  },
  "colors.fuchsia.200": {
    "value": "#f5d0fe",
    "variable": "var(--tocyn-colors-fuchsia-200)"
  },
  "colors.fuchsia.300": {
    "value": "#f0abfc",
    "variable": "var(--tocyn-colors-fuchsia-300)"
  },
  "colors.fuchsia.400": {
    "value": "#e879f9",
    "variable": "var(--tocyn-colors-fuchsia-400)"
  },
  "colors.fuchsia.500": {
    "value": "#d946ef",
    "variable": "var(--tocyn-colors-fuchsia-500)"
  },
  "colors.fuchsia.600": {
    "value": "#c026d3",
    "variable": "var(--tocyn-colors-fuchsia-600)"
  },
  "colors.fuchsia.700": {
    "value": "#a21caf",
    "variable": "var(--tocyn-colors-fuchsia-700)"
  },
  "colors.fuchsia.800": {
    "value": "#86198f",
    "variable": "var(--tocyn-colors-fuchsia-800)"
  },
  "colors.fuchsia.900": {
    "value": "#701a75",
    "variable": "var(--tocyn-colors-fuchsia-900)"
  },
  "colors.fuchsia.950": {
    "value": "#4a044e",
    "variable": "var(--tocyn-colors-fuchsia-950)"
  },
  "colors.purple.50": {
    "value": "#faf5ff",
    "variable": "var(--tocyn-colors-purple-50)"
  },
  "colors.purple.100": {
    "value": "#f3e8ff",
    "variable": "var(--tocyn-colors-purple-100)"
  },
  "colors.purple.200": {
    "value": "#e9d5ff",
    "variable": "var(--tocyn-colors-purple-200)"
  },
  "colors.purple.300": {
    "value": "#d8b4fe",
    "variable": "var(--tocyn-colors-purple-300)"
  },
  "colors.purple.400": {
    "value": "#c084fc",
    "variable": "var(--tocyn-colors-purple-400)"
  },
  "colors.purple.500": {
    "value": "#a855f7",
    "variable": "var(--tocyn-colors-purple-500)"
  },
  "colors.purple.600": {
    "value": "#9333ea",
    "variable": "var(--tocyn-colors-purple-600)"
  },
  "colors.purple.700": {
    "value": "#7e22ce",
    "variable": "var(--tocyn-colors-purple-700)"
  },
  "colors.purple.800": {
    "value": "#6b21a8",
    "variable": "var(--tocyn-colors-purple-800)"
  },
  "colors.purple.900": {
    "value": "#581c87",
    "variable": "var(--tocyn-colors-purple-900)"
  },
  "colors.purple.950": {
    "value": "#3b0764",
    "variable": "var(--tocyn-colors-purple-950)"
  },
  "colors.violet.50": {
    "value": "#f5f3ff",
    "variable": "var(--tocyn-colors-violet-50)"
  },
  "colors.violet.100": {
    "value": "#ede9fe",
    "variable": "var(--tocyn-colors-violet-100)"
  },
  "colors.violet.200": {
    "value": "#ddd6fe",
    "variable": "var(--tocyn-colors-violet-200)"
  },
  "colors.violet.300": {
    "value": "#c4b5fd",
    "variable": "var(--tocyn-colors-violet-300)"
  },
  "colors.violet.400": {
    "value": "#a78bfa",
    "variable": "var(--tocyn-colors-violet-400)"
  },
  "colors.violet.500": {
    "value": "#8b5cf6",
    "variable": "var(--tocyn-colors-violet-500)"
  },
  "colors.violet.600": {
    "value": "#7c3aed",
    "variable": "var(--tocyn-colors-violet-600)"
  },
  "colors.violet.700": {
    "value": "#6d28d9",
    "variable": "var(--tocyn-colors-violet-700)"
  },
  "colors.violet.800": {
    "value": "#5b21b6",
    "variable": "var(--tocyn-colors-violet-800)"
  },
  "colors.violet.900": {
    "value": "#4c1d95",
    "variable": "var(--tocyn-colors-violet-900)"
  },
  "colors.violet.950": {
    "value": "#2e1065",
    "variable": "var(--tocyn-colors-violet-950)"
  },
  "colors.indigo.50": {
    "value": "#eef2ff",
    "variable": "var(--tocyn-colors-indigo-50)"
  },
  "colors.indigo.100": {
    "value": "#e0e7ff",
    "variable": "var(--tocyn-colors-indigo-100)"
  },
  "colors.indigo.200": {
    "value": "#c7d2fe",
    "variable": "var(--tocyn-colors-indigo-200)"
  },
  "colors.indigo.300": {
    "value": "#a5b4fc",
    "variable": "var(--tocyn-colors-indigo-300)"
  },
  "colors.indigo.400": {
    "value": "#818cf8",
    "variable": "var(--tocyn-colors-indigo-400)"
  },
  "colors.indigo.500": {
    "value": "#6366f1",
    "variable": "var(--tocyn-colors-indigo-500)"
  },
  "colors.indigo.600": {
    "value": "#4f46e5",
    "variable": "var(--tocyn-colors-indigo-600)"
  },
  "colors.indigo.700": {
    "value": "#4338ca",
    "variable": "var(--tocyn-colors-indigo-700)"
  },
  "colors.indigo.800": {
    "value": "#3730a3",
    "variable": "var(--tocyn-colors-indigo-800)"
  },
  "colors.indigo.900": {
    "value": "#312e81",
    "variable": "var(--tocyn-colors-indigo-900)"
  },
  "colors.indigo.950": {
    "value": "#1e1b4b",
    "variable": "var(--tocyn-colors-indigo-950)"
  },
  "colors.blue.50": {
    "value": "#eff6ff",
    "variable": "var(--tocyn-colors-blue-50)"
  },
  "colors.blue.100": {
    "value": "#dbeafe",
    "variable": "var(--tocyn-colors-blue-100)"
  },
  "colors.blue.200": {
    "value": "#bfdbfe",
    "variable": "var(--tocyn-colors-blue-200)"
  },
  "colors.blue.300": {
    "value": "#93c5fd",
    "variable": "var(--tocyn-colors-blue-300)"
  },
  "colors.blue.400": {
    "value": "#60a5fa",
    "variable": "var(--tocyn-colors-blue-400)"
  },
  "colors.blue.500": {
    "value": "#3b82f6",
    "variable": "var(--tocyn-colors-blue-500)"
  },
  "colors.blue.600": {
    "value": "#2563eb",
    "variable": "var(--tocyn-colors-blue-600)"
  },
  "colors.blue.700": {
    "value": "#1d4ed8",
    "variable": "var(--tocyn-colors-blue-700)"
  },
  "colors.blue.800": {
    "value": "#1e40af",
    "variable": "var(--tocyn-colors-blue-800)"
  },
  "colors.blue.900": {
    "value": "#1e3a8a",
    "variable": "var(--tocyn-colors-blue-900)"
  },
  "colors.blue.950": {
    "value": "#172554",
    "variable": "var(--tocyn-colors-blue-950)"
  },
  "colors.sky.50": {
    "value": "#f0f9ff",
    "variable": "var(--tocyn-colors-sky-50)"
  },
  "colors.sky.100": {
    "value": "#e0f2fe",
    "variable": "var(--tocyn-colors-sky-100)"
  },
  "colors.sky.200": {
    "value": "#bae6fd",
    "variable": "var(--tocyn-colors-sky-200)"
  },
  "colors.sky.300": {
    "value": "#7dd3fc",
    "variable": "var(--tocyn-colors-sky-300)"
  },
  "colors.sky.400": {
    "value": "#38bdf8",
    "variable": "var(--tocyn-colors-sky-400)"
  },
  "colors.sky.500": {
    "value": "#0ea5e9",
    "variable": "var(--tocyn-colors-sky-500)"
  },
  "colors.sky.600": {
    "value": "#0284c7",
    "variable": "var(--tocyn-colors-sky-600)"
  },
  "colors.sky.700": {
    "value": "#0369a1",
    "variable": "var(--tocyn-colors-sky-700)"
  },
  "colors.sky.800": {
    "value": "#075985",
    "variable": "var(--tocyn-colors-sky-800)"
  },
  "colors.sky.900": {
    "value": "#0c4a6e",
    "variable": "var(--tocyn-colors-sky-900)"
  },
  "colors.sky.950": {
    "value": "#082f49",
    "variable": "var(--tocyn-colors-sky-950)"
  },
  "colors.cyan.50": {
    "value": "#ecfeff",
    "variable": "var(--tocyn-colors-cyan-50)"
  },
  "colors.cyan.100": {
    "value": "#cffafe",
    "variable": "var(--tocyn-colors-cyan-100)"
  },
  "colors.cyan.200": {
    "value": "#a5f3fc",
    "variable": "var(--tocyn-colors-cyan-200)"
  },
  "colors.cyan.300": {
    "value": "#67e8f9",
    "variable": "var(--tocyn-colors-cyan-300)"
  },
  "colors.cyan.400": {
    "value": "#22d3ee",
    "variable": "var(--tocyn-colors-cyan-400)"
  },
  "colors.cyan.500": {
    "value": "#06b6d4",
    "variable": "var(--tocyn-colors-cyan-500)"
  },
  "colors.cyan.600": {
    "value": "#0891b2",
    "variable": "var(--tocyn-colors-cyan-600)"
  },
  "colors.cyan.700": {
    "value": "#0e7490",
    "variable": "var(--tocyn-colors-cyan-700)"
  },
  "colors.cyan.800": {
    "value": "#155e75",
    "variable": "var(--tocyn-colors-cyan-800)"
  },
  "colors.cyan.900": {
    "value": "#164e63",
    "variable": "var(--tocyn-colors-cyan-900)"
  },
  "colors.cyan.950": {
    "value": "#083344",
    "variable": "var(--tocyn-colors-cyan-950)"
  },
  "colors.teal.50": {
    "value": "#f0fdfa",
    "variable": "var(--tocyn-colors-teal-50)"
  },
  "colors.teal.100": {
    "value": "#ccfbf1",
    "variable": "var(--tocyn-colors-teal-100)"
  },
  "colors.teal.200": {
    "value": "#99f6e4",
    "variable": "var(--tocyn-colors-teal-200)"
  },
  "colors.teal.300": {
    "value": "#5eead4",
    "variable": "var(--tocyn-colors-teal-300)"
  },
  "colors.teal.400": {
    "value": "#2dd4bf",
    "variable": "var(--tocyn-colors-teal-400)"
  },
  "colors.teal.500": {
    "value": "#14b8a6",
    "variable": "var(--tocyn-colors-teal-500)"
  },
  "colors.teal.600": {
    "value": "#0d9488",
    "variable": "var(--tocyn-colors-teal-600)"
  },
  "colors.teal.700": {
    "value": "#0f766e",
    "variable": "var(--tocyn-colors-teal-700)"
  },
  "colors.teal.800": {
    "value": "#115e59",
    "variable": "var(--tocyn-colors-teal-800)"
  },
  "colors.teal.900": {
    "value": "#134e4a",
    "variable": "var(--tocyn-colors-teal-900)"
  },
  "colors.teal.950": {
    "value": "#042f2e",
    "variable": "var(--tocyn-colors-teal-950)"
  },
  "colors.emerald.50": {
    "value": "#ecfdf5",
    "variable": "var(--tocyn-colors-emerald-50)"
  },
  "colors.emerald.100": {
    "value": "#d1fae5",
    "variable": "var(--tocyn-colors-emerald-100)"
  },
  "colors.emerald.200": {
    "value": "#a7f3d0",
    "variable": "var(--tocyn-colors-emerald-200)"
  },
  "colors.emerald.300": {
    "value": "#6ee7b7",
    "variable": "var(--tocyn-colors-emerald-300)"
  },
  "colors.emerald.400": {
    "value": "#34d399",
    "variable": "var(--tocyn-colors-emerald-400)"
  },
  "colors.emerald.500": {
    "value": "#10b981",
    "variable": "var(--tocyn-colors-emerald-500)"
  },
  "colors.emerald.600": {
    "value": "#059669",
    "variable": "var(--tocyn-colors-emerald-600)"
  },
  "colors.emerald.700": {
    "value": "#047857",
    "variable": "var(--tocyn-colors-emerald-700)"
  },
  "colors.emerald.800": {
    "value": "#065f46",
    "variable": "var(--tocyn-colors-emerald-800)"
  },
  "colors.emerald.900": {
    "value": "#064e3b",
    "variable": "var(--tocyn-colors-emerald-900)"
  },
  "colors.emerald.950": {
    "value": "#022c22",
    "variable": "var(--tocyn-colors-emerald-950)"
  },
  "colors.green.50": {
    "value": "#f0fdf4",
    "variable": "var(--tocyn-colors-green-50)"
  },
  "colors.green.100": {
    "value": "#dcfce7",
    "variable": "var(--tocyn-colors-green-100)"
  },
  "colors.green.200": {
    "value": "#bbf7d0",
    "variable": "var(--tocyn-colors-green-200)"
  },
  "colors.green.300": {
    "value": "#86efac",
    "variable": "var(--tocyn-colors-green-300)"
  },
  "colors.green.400": {
    "value": "#4ade80",
    "variable": "var(--tocyn-colors-green-400)"
  },
  "colors.green.500": {
    "value": "#22c55e",
    "variable": "var(--tocyn-colors-green-500)"
  },
  "colors.green.600": {
    "value": "#16a34a",
    "variable": "var(--tocyn-colors-green-600)"
  },
  "colors.green.700": {
    "value": "#15803d",
    "variable": "var(--tocyn-colors-green-700)"
  },
  "colors.green.800": {
    "value": "#166534",
    "variable": "var(--tocyn-colors-green-800)"
  },
  "colors.green.900": {
    "value": "#14532d",
    "variable": "var(--tocyn-colors-green-900)"
  },
  "colors.green.950": {
    "value": "#052e16",
    "variable": "var(--tocyn-colors-green-950)"
  },
  "colors.lime.50": {
    "value": "#f7fee7",
    "variable": "var(--tocyn-colors-lime-50)"
  },
  "colors.lime.100": {
    "value": "#ecfccb",
    "variable": "var(--tocyn-colors-lime-100)"
  },
  "colors.lime.200": {
    "value": "#d9f99d",
    "variable": "var(--tocyn-colors-lime-200)"
  },
  "colors.lime.300": {
    "value": "#bef264",
    "variable": "var(--tocyn-colors-lime-300)"
  },
  "colors.lime.400": {
    "value": "#a3e635",
    "variable": "var(--tocyn-colors-lime-400)"
  },
  "colors.lime.500": {
    "value": "#84cc16",
    "variable": "var(--tocyn-colors-lime-500)"
  },
  "colors.lime.600": {
    "value": "#65a30d",
    "variable": "var(--tocyn-colors-lime-600)"
  },
  "colors.lime.700": {
    "value": "#4d7c0f",
    "variable": "var(--tocyn-colors-lime-700)"
  },
  "colors.lime.800": {
    "value": "#3f6212",
    "variable": "var(--tocyn-colors-lime-800)"
  },
  "colors.lime.900": {
    "value": "#365314",
    "variable": "var(--tocyn-colors-lime-900)"
  },
  "colors.lime.950": {
    "value": "#1a2e05",
    "variable": "var(--tocyn-colors-lime-950)"
  },
  "colors.yellow.50": {
    "value": "#fefce8",
    "variable": "var(--tocyn-colors-yellow-50)"
  },
  "colors.yellow.100": {
    "value": "#fef9c3",
    "variable": "var(--tocyn-colors-yellow-100)"
  },
  "colors.yellow.200": {
    "value": "#fef08a",
    "variable": "var(--tocyn-colors-yellow-200)"
  },
  "colors.yellow.300": {
    "value": "#fde047",
    "variable": "var(--tocyn-colors-yellow-300)"
  },
  "colors.yellow.400": {
    "value": "#facc15",
    "variable": "var(--tocyn-colors-yellow-400)"
  },
  "colors.yellow.500": {
    "value": "#eab308",
    "variable": "var(--tocyn-colors-yellow-500)"
  },
  "colors.yellow.600": {
    "value": "#ca8a04",
    "variable": "var(--tocyn-colors-yellow-600)"
  },
  "colors.yellow.700": {
    "value": "#a16207",
    "variable": "var(--tocyn-colors-yellow-700)"
  },
  "colors.yellow.800": {
    "value": "#854d0e",
    "variable": "var(--tocyn-colors-yellow-800)"
  },
  "colors.yellow.900": {
    "value": "#713f12",
    "variable": "var(--tocyn-colors-yellow-900)"
  },
  "colors.yellow.950": {
    "value": "#422006",
    "variable": "var(--tocyn-colors-yellow-950)"
  },
  "colors.amber.50": {
    "value": "#fffbeb",
    "variable": "var(--tocyn-colors-amber-50)"
  },
  "colors.amber.100": {
    "value": "#fef3c7",
    "variable": "var(--tocyn-colors-amber-100)"
  },
  "colors.amber.200": {
    "value": "#fde68a",
    "variable": "var(--tocyn-colors-amber-200)"
  },
  "colors.amber.300": {
    "value": "#fcd34d",
    "variable": "var(--tocyn-colors-amber-300)"
  },
  "colors.amber.400": {
    "value": "#fbbf24",
    "variable": "var(--tocyn-colors-amber-400)"
  },
  "colors.amber.500": {
    "value": "#f59e0b",
    "variable": "var(--tocyn-colors-amber-500)"
  },
  "colors.amber.600": {
    "value": "#d97706",
    "variable": "var(--tocyn-colors-amber-600)"
  },
  "colors.amber.700": {
    "value": "#b45309",
    "variable": "var(--tocyn-colors-amber-700)"
  },
  "colors.amber.800": {
    "value": "#92400e",
    "variable": "var(--tocyn-colors-amber-800)"
  },
  "colors.amber.900": {
    "value": "#78350f",
    "variable": "var(--tocyn-colors-amber-900)"
  },
  "colors.amber.950": {
    "value": "#451a03",
    "variable": "var(--tocyn-colors-amber-950)"
  },
  "colors.orange.50": {
    "value": "#fff7ed",
    "variable": "var(--tocyn-colors-orange-50)"
  },
  "colors.orange.100": {
    "value": "#ffedd5",
    "variable": "var(--tocyn-colors-orange-100)"
  },
  "colors.orange.200": {
    "value": "#fed7aa",
    "variable": "var(--tocyn-colors-orange-200)"
  },
  "colors.orange.300": {
    "value": "#fdba74",
    "variable": "var(--tocyn-colors-orange-300)"
  },
  "colors.orange.400": {
    "value": "#fb923c",
    "variable": "var(--tocyn-colors-orange-400)"
  },
  "colors.orange.500": {
    "value": "#f97316",
    "variable": "var(--tocyn-colors-orange-500)"
  },
  "colors.orange.600": {
    "value": "#ea580c",
    "variable": "var(--tocyn-colors-orange-600)"
  },
  "colors.orange.700": {
    "value": "#c2410c",
    "variable": "var(--tocyn-colors-orange-700)"
  },
  "colors.orange.800": {
    "value": "#9a3412",
    "variable": "var(--tocyn-colors-orange-800)"
  },
  "colors.orange.900": {
    "value": "#7c2d12",
    "variable": "var(--tocyn-colors-orange-900)"
  },
  "colors.orange.950": {
    "value": "#431407",
    "variable": "var(--tocyn-colors-orange-950)"
  },
  "colors.red.50": {
    "value": "#fef2f2",
    "variable": "var(--tocyn-colors-red-50)"
  },
  "colors.red.100": {
    "value": "#fee2e2",
    "variable": "var(--tocyn-colors-red-100)"
  },
  "colors.red.200": {
    "value": "#fecaca",
    "variable": "var(--tocyn-colors-red-200)"
  },
  "colors.red.300": {
    "value": "#fca5a5",
    "variable": "var(--tocyn-colors-red-300)"
  },
  "colors.red.400": {
    "value": "#f87171",
    "variable": "var(--tocyn-colors-red-400)"
  },
  "colors.red.500": {
    "value": "#ef4444",
    "variable": "var(--tocyn-colors-red-500)"
  },
  "colors.red.600": {
    "value": "#dc2626",
    "variable": "var(--tocyn-colors-red-600)"
  },
  "colors.red.700": {
    "value": "#b91c1c",
    "variable": "var(--tocyn-colors-red-700)"
  },
  "colors.red.800": {
    "value": "#991b1b",
    "variable": "var(--tocyn-colors-red-800)"
  },
  "colors.red.900": {
    "value": "#7f1d1d",
    "variable": "var(--tocyn-colors-red-900)"
  },
  "colors.red.950": {
    "value": "#450a0a",
    "variable": "var(--tocyn-colors-red-950)"
  },
  "colors.neutral.50": {
    "value": "#fafafa",
    "variable": "var(--tocyn-colors-neutral-50)"
  },
  "colors.neutral.100": {
    "value": "#f5f5f5",
    "variable": "var(--tocyn-colors-neutral-100)"
  },
  "colors.neutral.200": {
    "value": "#e5e5e5",
    "variable": "var(--tocyn-colors-neutral-200)"
  },
  "colors.neutral.300": {
    "value": "#d4d4d4",
    "variable": "var(--tocyn-colors-neutral-300)"
  },
  "colors.neutral.400": {
    "value": "#a3a3a3",
    "variable": "var(--tocyn-colors-neutral-400)"
  },
  "colors.neutral.500": {
    "value": "#737373",
    "variable": "var(--tocyn-colors-neutral-500)"
  },
  "colors.neutral.600": {
    "value": "#525252",
    "variable": "var(--tocyn-colors-neutral-600)"
  },
  "colors.neutral.700": {
    "value": "#404040",
    "variable": "var(--tocyn-colors-neutral-700)"
  },
  "colors.neutral.800": {
    "value": "#262626",
    "variable": "var(--tocyn-colors-neutral-800)"
  },
  "colors.neutral.900": {
    "value": "#171717",
    "variable": "var(--tocyn-colors-neutral-900)"
  },
  "colors.neutral.950": {
    "value": "#0a0a0a",
    "variable": "var(--tocyn-colors-neutral-950)"
  },
  "colors.stone.50": {
    "value": "#fafaf9",
    "variable": "var(--tocyn-colors-stone-50)"
  },
  "colors.stone.100": {
    "value": "#f5f5f4",
    "variable": "var(--tocyn-colors-stone-100)"
  },
  "colors.stone.200": {
    "value": "#e7e5e4",
    "variable": "var(--tocyn-colors-stone-200)"
  },
  "colors.stone.300": {
    "value": "#d6d3d1",
    "variable": "var(--tocyn-colors-stone-300)"
  },
  "colors.stone.400": {
    "value": "#a8a29e",
    "variable": "var(--tocyn-colors-stone-400)"
  },
  "colors.stone.500": {
    "value": "#78716c",
    "variable": "var(--tocyn-colors-stone-500)"
  },
  "colors.stone.600": {
    "value": "#57534e",
    "variable": "var(--tocyn-colors-stone-600)"
  },
  "colors.stone.700": {
    "value": "#44403c",
    "variable": "var(--tocyn-colors-stone-700)"
  },
  "colors.stone.800": {
    "value": "#292524",
    "variable": "var(--tocyn-colors-stone-800)"
  },
  "colors.stone.900": {
    "value": "#1c1917",
    "variable": "var(--tocyn-colors-stone-900)"
  },
  "colors.stone.950": {
    "value": "#0c0a09",
    "variable": "var(--tocyn-colors-stone-950)"
  },
  "colors.zinc.50": {
    "value": "#fafafa",
    "variable": "var(--tocyn-colors-zinc-50)"
  },
  "colors.zinc.100": {
    "value": "#f4f4f5",
    "variable": "var(--tocyn-colors-zinc-100)"
  },
  "colors.zinc.200": {
    "value": "#e4e4e7",
    "variable": "var(--tocyn-colors-zinc-200)"
  },
  "colors.zinc.300": {
    "value": "#d4d4d8",
    "variable": "var(--tocyn-colors-zinc-300)"
  },
  "colors.zinc.400": {
    "value": "#a1a1aa",
    "variable": "var(--tocyn-colors-zinc-400)"
  },
  "colors.zinc.500": {
    "value": "#71717a",
    "variable": "var(--tocyn-colors-zinc-500)"
  },
  "colors.zinc.600": {
    "value": "#52525b",
    "variable": "var(--tocyn-colors-zinc-600)"
  },
  "colors.zinc.700": {
    "value": "#3f3f46",
    "variable": "var(--tocyn-colors-zinc-700)"
  },
  "colors.zinc.800": {
    "value": "#27272a",
    "variable": "var(--tocyn-colors-zinc-800)"
  },
  "colors.zinc.900": {
    "value": "#18181b",
    "variable": "var(--tocyn-colors-zinc-900)"
  },
  "colors.zinc.950": {
    "value": "#09090b",
    "variable": "var(--tocyn-colors-zinc-950)"
  },
  "colors.gray.50": {
    "value": "#f9fafb",
    "variable": "var(--tocyn-colors-gray-50)"
  },
  "colors.gray.100": {
    "value": "#f3f4f6",
    "variable": "var(--tocyn-colors-gray-100)"
  },
  "colors.gray.200": {
    "value": "#e5e7eb",
    "variable": "var(--tocyn-colors-gray-200)"
  },
  "colors.gray.300": {
    "value": "#d1d5db",
    "variable": "var(--tocyn-colors-gray-300)"
  },
  "colors.gray.400": {
    "value": "#9ca3af",
    "variable": "var(--tocyn-colors-gray-400)"
  },
  "colors.gray.500": {
    "value": "#6b7280",
    "variable": "var(--tocyn-colors-gray-500)"
  },
  "colors.gray.600": {
    "value": "#4b5563",
    "variable": "var(--tocyn-colors-gray-600)"
  },
  "colors.gray.700": {
    "value": "#374151",
    "variable": "var(--tocyn-colors-gray-700)"
  },
  "colors.gray.800": {
    "value": "#1f2937",
    "variable": "var(--tocyn-colors-gray-800)"
  },
  "colors.gray.900": {
    "value": "#111827",
    "variable": "var(--tocyn-colors-gray-900)"
  },
  "colors.gray.950": {
    "value": "#030712",
    "variable": "var(--tocyn-colors-gray-950)"
  },
  "colors.slate.50": {
    "value": "#f8fafc",
    "variable": "var(--tocyn-colors-slate-50)"
  },
  "colors.slate.100": {
    "value": "#f1f5f9",
    "variable": "var(--tocyn-colors-slate-100)"
  },
  "colors.slate.200": {
    "value": "#e2e8f0",
    "variable": "var(--tocyn-colors-slate-200)"
  },
  "colors.slate.300": {
    "value": "#cbd5e1",
    "variable": "var(--tocyn-colors-slate-300)"
  },
  "colors.slate.400": {
    "value": "#94a3b8",
    "variable": "var(--tocyn-colors-slate-400)"
  },
  "colors.slate.500": {
    "value": "#64748b",
    "variable": "var(--tocyn-colors-slate-500)"
  },
  "colors.slate.600": {
    "value": "#475569",
    "variable": "var(--tocyn-colors-slate-600)"
  },
  "colors.slate.700": {
    "value": "#334155",
    "variable": "var(--tocyn-colors-slate-700)"
  },
  "colors.slate.800": {
    "value": "#1e293b",
    "variable": "var(--tocyn-colors-slate-800)"
  },
  "colors.slate.900": {
    "value": "#0f172a",
    "variable": "var(--tocyn-colors-slate-900)"
  },
  "colors.slate.950": {
    "value": "#020617",
    "variable": "var(--tocyn-colors-slate-950)"
  },
  "blurs.xs": {
    "value": "4px",
    "variable": "var(--tocyn-blurs-xs)"
  },
  "blurs.sm": {
    "value": "8px",
    "variable": "var(--tocyn-blurs-sm)"
  },
  "blurs.md": {
    "value": "12px",
    "variable": "var(--tocyn-blurs-md)"
  },
  "blurs.lg": {
    "value": "16px",
    "variable": "var(--tocyn-blurs-lg)"
  },
  "blurs.xl": {
    "value": "24px",
    "variable": "var(--tocyn-blurs-xl)"
  },
  "blurs.2xl": {
    "value": "40px",
    "variable": "var(--tocyn-blurs-2xl)"
  },
  "blurs.3xl": {
    "value": "64px",
    "variable": "var(--tocyn-blurs-3xl)"
  },
  "spacing.0": {
    "value": "0rem",
    "variable": "var(--tocyn-spacing-0)"
  },
  "spacing.1": {
    "value": "0.25rem",
    "variable": "var(--tocyn-spacing-1)"
  },
  "spacing.2": {
    "value": "0.5rem",
    "variable": "var(--tocyn-spacing-2)"
  },
  "spacing.3": {
    "value": "0.75rem",
    "variable": "var(--tocyn-spacing-3)"
  },
  "spacing.4": {
    "value": "1rem",
    "variable": "var(--tocyn-spacing-4)"
  },
  "spacing.5": {
    "value": "1.25rem",
    "variable": "var(--tocyn-spacing-5)"
  },
  "spacing.6": {
    "value": "1.5rem",
    "variable": "var(--tocyn-spacing-6)"
  },
  "spacing.7": {
    "value": "1.75rem",
    "variable": "var(--tocyn-spacing-7)"
  },
  "spacing.8": {
    "value": "2rem",
    "variable": "var(--tocyn-spacing-8)"
  },
  "spacing.9": {
    "value": "2.25rem",
    "variable": "var(--tocyn-spacing-9)"
  },
  "spacing.10": {
    "value": "2.5rem",
    "variable": "var(--tocyn-spacing-10)"
  },
  "spacing.11": {
    "value": "2.75rem",
    "variable": "var(--tocyn-spacing-11)"
  },
  "spacing.12": {
    "value": "3rem",
    "variable": "var(--tocyn-spacing-12)"
  },
  "spacing.14": {
    "value": "3.5rem",
    "variable": "var(--tocyn-spacing-14)"
  },
  "spacing.16": {
    "value": "4rem",
    "variable": "var(--tocyn-spacing-16)"
  },
  "spacing.20": {
    "value": "5rem",
    "variable": "var(--tocyn-spacing-20)"
  },
  "spacing.24": {
    "value": "6rem",
    "variable": "var(--tocyn-spacing-24)"
  },
  "spacing.28": {
    "value": "7rem",
    "variable": "var(--tocyn-spacing-28)"
  },
  "spacing.32": {
    "value": "8rem",
    "variable": "var(--tocyn-spacing-32)"
  },
  "spacing.36": {
    "value": "9rem",
    "variable": "var(--tocyn-spacing-36)"
  },
  "spacing.40": {
    "value": "10rem",
    "variable": "var(--tocyn-spacing-40)"
  },
  "spacing.44": {
    "value": "11rem",
    "variable": "var(--tocyn-spacing-44)"
  },
  "spacing.48": {
    "value": "12rem",
    "variable": "var(--tocyn-spacing-48)"
  },
  "spacing.52": {
    "value": "13rem",
    "variable": "var(--tocyn-spacing-52)"
  },
  "spacing.56": {
    "value": "14rem",
    "variable": "var(--tocyn-spacing-56)"
  },
  "spacing.60": {
    "value": "15rem",
    "variable": "var(--tocyn-spacing-60)"
  },
  "spacing.64": {
    "value": "16rem",
    "variable": "var(--tocyn-spacing-64)"
  },
  "spacing.72": {
    "value": "18rem",
    "variable": "var(--tocyn-spacing-72)"
  },
  "spacing.80": {
    "value": "20rem",
    "variable": "var(--tocyn-spacing-80)"
  },
  "spacing.96": {
    "value": "24rem",
    "variable": "var(--tocyn-spacing-96)"
  },
  "spacing.0.5": {
    "value": "0.125rem",
    "variable": "var(--tocyn-spacing-0\\.5)"
  },
  "spacing.1.5": {
    "value": "0.375rem",
    "variable": "var(--tocyn-spacing-1\\.5)"
  },
  "spacing.2.5": {
    "value": "0.625rem",
    "variable": "var(--tocyn-spacing-2\\.5)"
  },
  "spacing.3.5": {
    "value": "0.875rem",
    "variable": "var(--tocyn-spacing-3\\.5)"
  },
  "spacing.4.5": {
    "value": "1.125rem",
    "variable": "var(--tocyn-spacing-4\\.5)"
  },
  "spacing.5.5": {
    "value": "1.375rem",
    "variable": "var(--tocyn-spacing-5\\.5)"
  },
  "sizes.0": {
    "value": "0rem",
    "variable": "var(--tocyn-sizes-0)"
  },
  "sizes.1": {
    "value": "0.25rem",
    "variable": "var(--tocyn-sizes-1)"
  },
  "sizes.2": {
    "value": "0.5rem",
    "variable": "var(--tocyn-sizes-2)"
  },
  "sizes.3": {
    "value": "0.75rem",
    "variable": "var(--tocyn-sizes-3)"
  },
  "sizes.4": {
    "value": "1rem",
    "variable": "var(--tocyn-sizes-4)"
  },
  "sizes.5": {
    "value": "1.25rem",
    "variable": "var(--tocyn-sizes-5)"
  },
  "sizes.6": {
    "value": "1.5rem",
    "variable": "var(--tocyn-sizes-6)"
  },
  "sizes.7": {
    "value": "1.75rem",
    "variable": "var(--tocyn-sizes-7)"
  },
  "sizes.8": {
    "value": "2rem",
    "variable": "var(--tocyn-sizes-8)"
  },
  "sizes.9": {
    "value": "2.25rem",
    "variable": "var(--tocyn-sizes-9)"
  },
  "sizes.10": {
    "value": "2.5rem",
    "variable": "var(--tocyn-sizes-10)"
  },
  "sizes.11": {
    "value": "2.75rem",
    "variable": "var(--tocyn-sizes-11)"
  },
  "sizes.12": {
    "value": "3rem",
    "variable": "var(--tocyn-sizes-12)"
  },
  "sizes.14": {
    "value": "3.5rem",
    "variable": "var(--tocyn-sizes-14)"
  },
  "sizes.16": {
    "value": "4rem",
    "variable": "var(--tocyn-sizes-16)"
  },
  "sizes.20": {
    "value": "5rem",
    "variable": "var(--tocyn-sizes-20)"
  },
  "sizes.24": {
    "value": "6rem",
    "variable": "var(--tocyn-sizes-24)"
  },
  "sizes.28": {
    "value": "7rem",
    "variable": "var(--tocyn-sizes-28)"
  },
  "sizes.32": {
    "value": "8rem",
    "variable": "var(--tocyn-sizes-32)"
  },
  "sizes.36": {
    "value": "9rem",
    "variable": "var(--tocyn-sizes-36)"
  },
  "sizes.40": {
    "value": "10rem",
    "variable": "var(--tocyn-sizes-40)"
  },
  "sizes.44": {
    "value": "11rem",
    "variable": "var(--tocyn-sizes-44)"
  },
  "sizes.48": {
    "value": "12rem",
    "variable": "var(--tocyn-sizes-48)"
  },
  "sizes.52": {
    "value": "13rem",
    "variable": "var(--tocyn-sizes-52)"
  },
  "sizes.56": {
    "value": "14rem",
    "variable": "var(--tocyn-sizes-56)"
  },
  "sizes.60": {
    "value": "15rem",
    "variable": "var(--tocyn-sizes-60)"
  },
  "sizes.64": {
    "value": "16rem",
    "variable": "var(--tocyn-sizes-64)"
  },
  "sizes.72": {
    "value": "18rem",
    "variable": "var(--tocyn-sizes-72)"
  },
  "sizes.80": {
    "value": "20rem",
    "variable": "var(--tocyn-sizes-80)"
  },
  "sizes.96": {
    "value": "24rem",
    "variable": "var(--tocyn-sizes-96)"
  },
  "sizes.0.5": {
    "value": "0.125rem",
    "variable": "var(--tocyn-sizes-0\\.5)"
  },
  "sizes.1.5": {
    "value": "0.375rem",
    "variable": "var(--tocyn-sizes-1\\.5)"
  },
  "sizes.2.5": {
    "value": "0.625rem",
    "variable": "var(--tocyn-sizes-2\\.5)"
  },
  "sizes.3.5": {
    "value": "0.875rem",
    "variable": "var(--tocyn-sizes-3\\.5)"
  },
  "sizes.4.5": {
    "value": "1.125rem",
    "variable": "var(--tocyn-sizes-4\\.5)"
  },
  "sizes.5.5": {
    "value": "1.375rem",
    "variable": "var(--tocyn-sizes-5\\.5)"
  },
  "sizes.xs": {
    "value": "20rem",
    "variable": "var(--tocyn-sizes-xs)"
  },
  "sizes.sm": {
    "value": "24rem",
    "variable": "var(--tocyn-sizes-sm)"
  },
  "sizes.md": {
    "value": "28rem",
    "variable": "var(--tocyn-sizes-md)"
  },
  "sizes.lg": {
    "value": "32rem",
    "variable": "var(--tocyn-sizes-lg)"
  },
  "sizes.xl": {
    "value": "36rem",
    "variable": "var(--tocyn-sizes-xl)"
  },
  "sizes.2xl": {
    "value": "42rem",
    "variable": "var(--tocyn-sizes-2xl)"
  },
  "sizes.3xl": {
    "value": "48rem",
    "variable": "var(--tocyn-sizes-3xl)"
  },
  "sizes.4xl": {
    "value": "56rem",
    "variable": "var(--tocyn-sizes-4xl)"
  },
  "sizes.5xl": {
    "value": "64rem",
    "variable": "var(--tocyn-sizes-5xl)"
  },
  "sizes.6xl": {
    "value": "72rem",
    "variable": "var(--tocyn-sizes-6xl)"
  },
  "sizes.7xl": {
    "value": "80rem",
    "variable": "var(--tocyn-sizes-7xl)"
  },
  "sizes.8xl": {
    "value": "90rem",
    "variable": "var(--tocyn-sizes-8xl)"
  },
  "sizes.prose": {
    "value": "65ch",
    "variable": "var(--tocyn-sizes-prose)"
  },
  "sizes.full": {
    "value": "100%",
    "variable": "var(--tocyn-sizes-full)"
  },
  "sizes.min": {
    "value": "min-content",
    "variable": "var(--tocyn-sizes-min)"
  },
  "sizes.max": {
    "value": "max-content",
    "variable": "var(--tocyn-sizes-max)"
  },
  "sizes.fit": {
    "value": "fit-content",
    "variable": "var(--tocyn-sizes-fit)"
  },
  "sizes.breakpoint-sm": {
    "value": "640px",
    "variable": "var(--tocyn-sizes-breakpoint-sm)"
  },
  "sizes.breakpoint-md": {
    "value": "768px",
    "variable": "var(--tocyn-sizes-breakpoint-md)"
  },
  "sizes.breakpoint-lg": {
    "value": "1024px",
    "variable": "var(--tocyn-sizes-breakpoint-lg)"
  },
  "sizes.breakpoint-xl": {
    "value": "1280px",
    "variable": "var(--tocyn-sizes-breakpoint-xl)"
  },
  "sizes.breakpoint-2xl": {
    "value": "1536px",
    "variable": "var(--tocyn-sizes-breakpoint-2xl)"
  },
  "animations.spin": {
    "value": "spin 1s linear infinite",
    "variable": "var(--tocyn-animations-spin)"
  },
  "animations.ping": {
    "value": "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
    "variable": "var(--tocyn-animations-ping)"
  },
  "animations.pulse": {
    "value": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
    "variable": "var(--tocyn-animations-pulse)"
  },
  "animations.bounce": {
    "value": "bounce 1s infinite",
    "variable": "var(--tocyn-animations-bounce)"
  },
  "breakpoints.sm": {
    "value": "640px",
    "variable": "var(--tocyn-breakpoints-sm)"
  },
  "breakpoints.md": {
    "value": "768px",
    "variable": "var(--tocyn-breakpoints-md)"
  },
  "breakpoints.lg": {
    "value": "1024px",
    "variable": "var(--tocyn-breakpoints-lg)"
  },
  "breakpoints.xl": {
    "value": "1280px",
    "variable": "var(--tocyn-breakpoints-xl)"
  },
  "breakpoints.2xl": {
    "value": "1536px",
    "variable": "var(--tocyn-breakpoints-2xl)"
  },
  "colors.bg.canvas": {
    "value": "var(--tocyn-color-surface)",
    "variable": "var(--tocyn-colors-bg\\.canvas)"
  },
  "colors.bg.panel": {
    "value": "var(--tocyn-color-surface-panel)",
    "variable": "var(--tocyn-colors-bg\\.panel)"
  },
  "colors.bg.muted": {
    "value": "var(--tocyn-color-surface-muted)",
    "variable": "var(--tocyn-colors-bg\\.muted)"
  },
  "colors.bg.selected": {
    "value": "var(--tocyn-color-selected)",
    "variable": "var(--tocyn-colors-bg\\.selected)"
  },
  "colors.fg.default": {
    "value": "var(--tocyn-color-text)",
    "variable": "var(--tocyn-colors-fg\\.default)"
  },
  "colors.fg.muted": {
    "value": "var(--tocyn-color-text-muted)",
    "variable": "var(--tocyn-colors-fg\\.muted)"
  },
  "colors.fg.selected": {
    "value": "var(--tocyn-color-text)",
    "variable": "var(--tocyn-colors-fg\\.selected)"
  },
  "colors.border.default": {
    "value": "var(--tocyn-color-divider)",
    "variable": "var(--tocyn-colors-border\\.default)"
  },
  "colors.accent.default": {
    "value": "var(--tocyn-color-focus)",
    "variable": "var(--tocyn-colors-accent\\.default)"
  },
  "colors.accent.contrast": {
    "value": "var(--tocyn-color-surface)",
    "variable": "var(--tocyn-colors-accent\\.contrast)"
  },
  "colors.focus.ring": {
    "value": "var(--tocyn-color-focus)",
    "variable": "var(--tocyn-colors-focus\\.ring)"
  },
  "colors.danger.default": {
    "value": "var(--tocyn-color-critical)",
    "variable": "var(--tocyn-colors-danger\\.default)"
  },
  "colors.success.default": {
    "value": "var(--tocyn-color-focus)",
    "variable": "var(--tocyn-colors-success\\.default)"
  },
  "spacing.-1": {
    "value": "calc(var(--tocyn-spacing-1) * -1)",
    "variable": "var(--tocyn-spacing-1)"
  },
  "spacing.-2": {
    "value": "calc(var(--tocyn-spacing-2) * -1)",
    "variable": "var(--tocyn-spacing-2)"
  },
  "spacing.-3": {
    "value": "calc(var(--tocyn-spacing-3) * -1)",
    "variable": "var(--tocyn-spacing-3)"
  },
  "spacing.-4": {
    "value": "calc(var(--tocyn-spacing-4) * -1)",
    "variable": "var(--tocyn-spacing-4)"
  },
  "spacing.-5": {
    "value": "calc(var(--tocyn-spacing-5) * -1)",
    "variable": "var(--tocyn-spacing-5)"
  },
  "spacing.-6": {
    "value": "calc(var(--tocyn-spacing-6) * -1)",
    "variable": "var(--tocyn-spacing-6)"
  },
  "spacing.-7": {
    "value": "calc(var(--tocyn-spacing-7) * -1)",
    "variable": "var(--tocyn-spacing-7)"
  },
  "spacing.-8": {
    "value": "calc(var(--tocyn-spacing-8) * -1)",
    "variable": "var(--tocyn-spacing-8)"
  },
  "spacing.-9": {
    "value": "calc(var(--tocyn-spacing-9) * -1)",
    "variable": "var(--tocyn-spacing-9)"
  },
  "spacing.-10": {
    "value": "calc(var(--tocyn-spacing-10) * -1)",
    "variable": "var(--tocyn-spacing-10)"
  },
  "spacing.-11": {
    "value": "calc(var(--tocyn-spacing-11) * -1)",
    "variable": "var(--tocyn-spacing-11)"
  },
  "spacing.-12": {
    "value": "calc(var(--tocyn-spacing-12) * -1)",
    "variable": "var(--tocyn-spacing-12)"
  },
  "spacing.-14": {
    "value": "calc(var(--tocyn-spacing-14) * -1)",
    "variable": "var(--tocyn-spacing-14)"
  },
  "spacing.-16": {
    "value": "calc(var(--tocyn-spacing-16) * -1)",
    "variable": "var(--tocyn-spacing-16)"
  },
  "spacing.-20": {
    "value": "calc(var(--tocyn-spacing-20) * -1)",
    "variable": "var(--tocyn-spacing-20)"
  },
  "spacing.-24": {
    "value": "calc(var(--tocyn-spacing-24) * -1)",
    "variable": "var(--tocyn-spacing-24)"
  },
  "spacing.-28": {
    "value": "calc(var(--tocyn-spacing-28) * -1)",
    "variable": "var(--tocyn-spacing-28)"
  },
  "spacing.-32": {
    "value": "calc(var(--tocyn-spacing-32) * -1)",
    "variable": "var(--tocyn-spacing-32)"
  },
  "spacing.-36": {
    "value": "calc(var(--tocyn-spacing-36) * -1)",
    "variable": "var(--tocyn-spacing-36)"
  },
  "spacing.-40": {
    "value": "calc(var(--tocyn-spacing-40) * -1)",
    "variable": "var(--tocyn-spacing-40)"
  },
  "spacing.-44": {
    "value": "calc(var(--tocyn-spacing-44) * -1)",
    "variable": "var(--tocyn-spacing-44)"
  },
  "spacing.-48": {
    "value": "calc(var(--tocyn-spacing-48) * -1)",
    "variable": "var(--tocyn-spacing-48)"
  },
  "spacing.-52": {
    "value": "calc(var(--tocyn-spacing-52) * -1)",
    "variable": "var(--tocyn-spacing-52)"
  },
  "spacing.-56": {
    "value": "calc(var(--tocyn-spacing-56) * -1)",
    "variable": "var(--tocyn-spacing-56)"
  },
  "spacing.-60": {
    "value": "calc(var(--tocyn-spacing-60) * -1)",
    "variable": "var(--tocyn-spacing-60)"
  },
  "spacing.-64": {
    "value": "calc(var(--tocyn-spacing-64) * -1)",
    "variable": "var(--tocyn-spacing-64)"
  },
  "spacing.-72": {
    "value": "calc(var(--tocyn-spacing-72) * -1)",
    "variable": "var(--tocyn-spacing-72)"
  },
  "spacing.-80": {
    "value": "calc(var(--tocyn-spacing-80) * -1)",
    "variable": "var(--tocyn-spacing-80)"
  },
  "spacing.-96": {
    "value": "calc(var(--tocyn-spacing-96) * -1)",
    "variable": "var(--tocyn-spacing-96)"
  },
  "spacing.-0.5": {
    "value": "calc(var(--tocyn-spacing-0\\.5) * -1)",
    "variable": "var(--tocyn-spacing-0\\.5)"
  },
  "spacing.-1.5": {
    "value": "calc(var(--tocyn-spacing-1\\.5) * -1)",
    "variable": "var(--tocyn-spacing-1\\.5)"
  },
  "spacing.-2.5": {
    "value": "calc(var(--tocyn-spacing-2\\.5) * -1)",
    "variable": "var(--tocyn-spacing-2\\.5)"
  },
  "spacing.-3.5": {
    "value": "calc(var(--tocyn-spacing-3\\.5) * -1)",
    "variable": "var(--tocyn-spacing-3\\.5)"
  },
  "spacing.-4.5": {
    "value": "calc(var(--tocyn-spacing-4\\.5) * -1)",
    "variable": "var(--tocyn-spacing-4\\.5)"
  },
  "spacing.-5.5": {
    "value": "calc(var(--tocyn-spacing-5\\.5) * -1)",
    "variable": "var(--tocyn-spacing-5\\.5)"
  },
  "colors.colorPalette": {
    "value": "var(--tocyn-colors-color-palette)",
    "variable": "var(--tocyn-colors-color-palette)"
  },
  "colors.colorPalette.50": {
    "value": "var(--tocyn-colors-color-palette-50)",
    "variable": "var(--tocyn-colors-color-palette-50)"
  },
  "colors.colorPalette.100": {
    "value": "var(--tocyn-colors-color-palette-100)",
    "variable": "var(--tocyn-colors-color-palette-100)"
  },
  "colors.colorPalette.200": {
    "value": "var(--tocyn-colors-color-palette-200)",
    "variable": "var(--tocyn-colors-color-palette-200)"
  },
  "colors.colorPalette.300": {
    "value": "var(--tocyn-colors-color-palette-300)",
    "variable": "var(--tocyn-colors-color-palette-300)"
  },
  "colors.colorPalette.400": {
    "value": "var(--tocyn-colors-color-palette-400)",
    "variable": "var(--tocyn-colors-color-palette-400)"
  },
  "colors.colorPalette.500": {
    "value": "var(--tocyn-colors-color-palette-500)",
    "variable": "var(--tocyn-colors-color-palette-500)"
  },
  "colors.colorPalette.600": {
    "value": "var(--tocyn-colors-color-palette-600)",
    "variable": "var(--tocyn-colors-color-palette-600)"
  },
  "colors.colorPalette.700": {
    "value": "var(--tocyn-colors-color-palette-700)",
    "variable": "var(--tocyn-colors-color-palette-700)"
  },
  "colors.colorPalette.800": {
    "value": "var(--tocyn-colors-color-palette-800)",
    "variable": "var(--tocyn-colors-color-palette-800)"
  },
  "colors.colorPalette.900": {
    "value": "var(--tocyn-colors-color-palette-900)",
    "variable": "var(--tocyn-colors-color-palette-900)"
  },
  "colors.colorPalette.950": {
    "value": "var(--tocyn-colors-color-palette-950)",
    "variable": "var(--tocyn-colors-color-palette-950)"
  }
}

export function token(path, fallback) {
  return tokens[path]?.value || fallback
}

function tokenVar(path, fallback) {
  return tokens[path]?.variable || fallback
}

token.var = tokenVar