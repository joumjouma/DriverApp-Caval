// App-wide font: Plus Jakarta Sans.
// React 19 dropped defaultProps for function components, so instead we wrap
// Text/TextInput's render once and map fontWeight → the matching font file
// (custom fonts on Android ignore fontWeight).
import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { fonts } from '../constants/theme';

export const FONT_FILES = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
};

export const byWeight = (w) => {
  switch (String(w)) {
    case '500': return fonts.medium;
    case '600': return fonts.semibold;
    case 'bold': case '700': return fonts.bold;
    case '800': case '900': return fonts.extrabold;
    default: return fonts.regular;
  }
};

// In-app text size (Profil → Apparence), on top of the phone's own setting.
let textScale = 1;
export const setTextScale = (s) => { textScale = s || 1; };

function scaled(style) {
  if (textScale === 1) return style;
  const out = { ...style, fontSize: (style.fontSize || 14) * textScale };
  if (style.lineHeight) out.lineHeight = style.lineHeight * textScale;
  return out;
}

function withAppFont(Component) {
  const original = Component.render;
  if (!original || original.__cavalFont) return;
  const patched = function (props, ref) {
    const flat = StyleSheet.flatten(props.style) || {};
    if (flat.fontFamily && !String(flat.fontFamily).startsWith('System')) {
      // explicit font: keep it, just apply the text size
      return original.call(this, textScale === 1 ? props : { ...props, style: scaled(flat) }, ref);
    }
    const { fontWeight, ...rest } = flat;
    return original.call(this, { ...props, style: scaled({ ...rest, fontFamily: byWeight(fontWeight) }) }, ref);
  };
  patched.__cavalFont = true;
  Component.render = patched;
}

export function installAppFont() {
  withAppFont(Text);
  withAppFont(TextInput);
}
