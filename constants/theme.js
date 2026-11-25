// Caval design tokens — matches the approved redesign ("Caval customer app —
// redesign" canvas). Light and dark palettes (see context/ThemeContext.js). Orange marks the main action, the
// active tab and key highlights — never a whole surface.

// Light palette (the approved redesign)
export const lightColors = {
  // brand
  primary: '#FF6F00',        // buttons, active tab, map pin
  primaryPressed: '#E65C00',
  primaryText: '#B84A00',    // orange text/links on white (passes 4.5:1)
  primarySoft: '#FFF1E6',    // highlight backgrounds
  primaryLight: '#FFE0C7',   // avatar, selected icon tiles
  primaryTint: '#FFF7F0',    // selected option card
  onPrimary: '#1F1300',      // text on orange (white on #FF6F00 is only 2.9:1)
  onPrimaryMuted: 'rgba(31, 19, 0, 0.65)',

  // surfaces
  background: '#FAF8F5',     // list screens
  surface: '#FFFFFF',        // cards, sheets
  surfaceRaised: '#F3F0EC',  // chips, secondary buttons, inputs
  input: '#F3F0EC',
  border: '#ECE8E3',
  divider: '#F0ECE7',
  handle: '#E2DDD7',
  radioBorder: '#CFC8C1',
  routeLine: '#D9D3CC',
  chevron: '#A39B94',
  map: '#EEF0EA',
  overlay: 'rgba(23, 19, 15, 0.45)',

  // dark "emphasis" cards (current ride, ETA pill) — dark in both themes
  emphasis: '#17130F',
  onEmphasis: '#FFFFFF',
  onEmphasisMuted: '#E9E4DE',
  emphasisAccent: '#FFB27A',

  // text
  text: '#17130F',
  textSecondary: '#4B4540',
  textMuted: '#6F6862',
  placeholder: '#8A827B',
  textOnDark: '#FFFFFF',

  // status
  success: '#157F3B',
  successText: '#146C34',
  successSoft: '#E8F5EC',
  error: '#C62828',
  errorText: '#8E1C1C',
  errorSoft: '#FDECEC',
  warning: '#B26A00',
  info: '#1D5FBF',
  star: '#F5A623',

  white: '#FFFFFF',
  black: '#000000',
};

// Dark palette. Same roles; contrast checked for text on surface/background.
export const darkColors = {
  ...lightColors,
  primaryText: '#FF9A4D',
  primarySoft: '#36210F',
  primaryLight: '#4A2C14',
  primaryTint: '#2A1C10',

  background: '#121110',
  surface: '#1C1A18',
  surfaceRaised: '#272421',
  input: '#272421',
  border: '#34302B',
  divider: '#2B2824',
  handle: '#4A453F',
  radioBorder: '#5A544E',
  routeLine: '#4A453F',
  chevron: '#7A726B',
  map: '#1E201C',
  overlay: 'rgba(0, 0, 0, 0.6)',

  emphasis: '#2C2824',
  onEmphasisMuted: '#D6CFC7',

  text: '#F5F1EC',
  textSecondary: '#D2CBC3',
  textMuted: '#A59D95',
  placeholder: '#857D76',

  success: '#4CC27A',
  successText: '#7ED49C',
  successSoft: '#15301F',
  error: '#FF6B6B',
  errorText: '#FF9A9A',
  errorSoft: '#3A1A1A',
  warning: '#E0A040',
  info: '#6EA8FF',
};

// Static light palette for code outside components. Inside components use
// useTheme().colors so dark mode works.
export const colors = lightColors;

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

export const radius = { sm: 10, md: 14, lg: 16, xl: 18, sheet: 26, pill: 999 };

// Type scale (see "Système visuel" on the canvas)
export const typography = {
  display: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  bodyStrong: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.extrabold, fontSize: 13, lineHeight: 18, letterSpacing: 0.4, textTransform: 'uppercase' },
  button: { fontFamily: fonts.extrabold, fontSize: 17 },
  buttonSmall: { fontFamily: fonts.bold, fontSize: 15 },
};

export const shadow = {
  sheet: { shadowColor: '#17130F', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 12 },
  float: { shadowColor: '#17130F', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  card: { shadowColor: '#17130F', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
};

// Kept for older code that imports THEME
export const THEME = {
  primary: colors.primary,
  secondary: colors.surface,
  background: colors.background,
  text: colors.text,
  textSecondary: colors.textSecondary,
  border: colors.border,
  error: colors.error,
  success: colors.success,
  warning: colors.warning,
  info: colors.info,
  cardBackground: colors.surface,
  inputBackground: colors.input,
  placeholder: colors.placeholder,
  shadow: '#17130F',
  overlay: colors.overlay,
  ripple: colors.primarySoft,
  highlight: colors.primaryPressed,
  muted: colors.textMuted,
  divider: colors.divider,
  statusBar: 'dark-content',
  fontFamily: { regular: fonts.regular, medium: fonts.medium, bold: fonts.bold },
  spacing,
  borderRadius: { sm: radius.sm, md: radius.md, lg: radius.lg, xl: radius.xl, round: radius.pill },
};
