// Shared UI building blocks for the redesign. Every screen is built from these
// so spacing, type and color stay consistent. Matches the "Caval apps
// — redesign" canvas.
import React from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Text, TextInput, View, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typography, shadow } from '../../constants/theme';
import { byWeight } from '../../utils/fonts';
import { t } from '../../utils/i18n/index';
import { useTheme, makeStyles } from "../../context/ThemeContext";

/** Text with the app's type scale. variant: display|title|heading|bodyStrong|body|label|caption|overline */
export function AppText({ variant = 'body', color, style, children, ...rest }) {
  const { colors } = useTheme();
  if (color === undefined) color = colors.text;
  // A fontWeight in `style` picks the matching font file (custom fonts
  // don't synthesize weights on Android).
  const own = StyleSheet.flatten(style) || {};
  const weightFix = own.fontWeight && !own.fontFamily ? { fontFamily: byWeight(own.fontWeight), fontWeight: undefined } : null;
  return <Text style={[typography[variant], { color }, style, weightFix]} {...rest}>{children}</Text>;
}

/** Full screen with safe areas and the light background. */
export function Screen({ children, scroll = false, edges = ['top'], background, style, contentStyle }) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (background === undefined) background = colors.background;
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: background }, style]}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.scrollContent, contentStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Large page title (Activité, Profil). */
export function PageTitle({ children, style }) {
  return <AppText variant="display" accessibilityRole="header" style={[{ marginBottom: spacing.xl }, style]}>{children}</AppText>;
}

/** Back button + optional centered title. */
export function Header({ title, onBack, right }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.header}>
      {onBack ? <IconButton icon="chevron-back" label={t("Retour")} onPress={onBack} plain /> : <View style={{ width: 44 }} />}
      <AppText variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1} accessibilityRole="header">{title}</AppText>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** Round icon button. `floating` = white with shadow (on the map). */
export function IconButton({ icon, label, onPress, floating = false, plain = false, size = 48, color, style }) {
  const { colors } = useTheme();
  if (color === undefined) color = colors.text;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' },
        floating && { backgroundColor: colors.surface, ...shadow.float },
        !floating && !plain && { backgroundColor: colors.surfaceRaised },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

/**
 * Button. variant: primary (orange, one per screen) | secondary (beige) |
 * outline | ghost | danger (red text) | dangerOutline. size: lg (56) | md (52) | sm (48)
 */
export function Button({
  title, onPress, variant = 'primary', size = 'lg', loading = false, disabled = false, icon, style, accessibilityLabel,
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const v = buttonVariants(colors)[variant];
  const height = { lg: 56, md: 52, sm: 48 }[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { height, borderRadius: size === 'lg' ? radius.lg : radius.md, backgroundColor: v.bg, borderColor: v.border, borderWidth: v.border === 'transparent' ? 0 : 1.5 },
        pressed && !inactive && { backgroundColor: v.pressed || v.bg, opacity: v.pressed ? 1 : 0.8 },
        inactive && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={20} color={v.iconColor || v.fg} style={{ marginRight: spacing.sm }} /> : null}
          <Text style={[size === 'lg' ? typography.button : typography.buttonSmall, { color: v.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants = (colors) => ({
  primary: { bg: colors.primary, fg: colors.onPrimary, border: 'transparent', pressed: colors.primaryPressed },
  secondary: { bg: colors.surfaceRaised, fg: colors.text, border: 'transparent' },
  outline: { bg: colors.surface, fg: colors.text, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.text, border: 'transparent' },
  danger: { bg: 'transparent', fg: colors.errorText, border: 'transparent' },
  dangerOutline: { bg: colors.surface, fg: colors.errorText, border: colors.border },
});

/** White card with a hairline border. */
export function Card({ children, style }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Bottom sheet that sits on the map. */
export function Sheet({ children, style }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.sheet, style]}>
      <View style={styles.handle} />
      {children}
    </View>
  );
}

/** Labeled text field. */
export function Input({ label, error, hint, style, inputStyle, focused, ...rest }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[{ marginBottom: spacing.lg }, style]}>
      {label ? <AppText variant="label" color={colors.textSecondary} style={{ marginBottom: 6 }}>{label}</AppText> : null}
      <TextInput
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={label}
        style={[styles.input, focused && { borderColor: colors.primary, backgroundColor: colors.surface }, error && { borderColor: colors.error, backgroundColor: colors.surface }, inputStyle]}
        {...rest}
      />
      {hint && !error ? <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 6 }}>{hint}</AppText> : null}
    </View>
  );
}

/** Red inline error message. */
export function ErrorBanner({ message, style }) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={[styles.errorBanner, style]}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.errorText} style={{ marginTop: 1 }} />
      <AppText variant="caption" color={colors.errorText} style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{message}</AppText>
    </View>
  );
}

/** Icon in a soft square tile (list rows). */
export function IconTile({ icon, size = 40, color, background, iconSize = 18 }) {
  const { colors } = useTheme();
  if (color === undefined) color = colors.text;
  if (background === undefined) background = colors.surfaceRaised;
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={iconSize} color={color} />
    </View>
  );
}

/** Tappable list row: icon tile, label, optional hint, chevron. */
export function ListRow({ icon, label, sublabel, hint, onPress, last = false, destructive = false }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.listRow, !last && styles.listRowDivider, pressed && { backgroundColor: colors.background }]}
    >
      {icon ? <IconTile icon={icon} size={36} color={destructive ? colors.errorText : colors.text} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="body" style={{ fontWeight: '600' }} color={destructive ? colors.errorText : colors.text}>{label}</AppText>
        {sublabel ? <AppText variant="caption" color={colors.textMuted}>{sublabel}</AppText> : null}
      </View>
      {hint ? <AppText variant="caption" color={colors.textMuted} style={{ fontWeight: '600' }}>{hint}</AppText> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.chevron} />
    </Pressable>
  );
}

/** Small rounded status label. tone: success | neutral | orange */
export function Chip({ label, tone = 'neutral' }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = { success: [colors.successSoft, colors.successText], neutral: [colors.surfaceRaised, colors.textSecondary], orange: [colors.primarySoft, colors.primaryText] }[tone];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: t[0] }}>
      <AppText variant="caption" color={t[1]} style={{ fontSize: 12, fontWeight: '700' }}>{label}</AppText>
    </View>
  );
}

/** Pickup → destination summary with the orange dot and black square. */
export function RouteSummary({ from, to, trailing, style }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.route, style]}>
      <View style={{ alignItems: 'center', paddingTop: 5 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />
        <View style={{ width: 2, height: 26, backgroundColor: colors.routeLine, marginVertical: 3 }} />
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.text }} />
      </View>
      <View style={{ flex: 1, gap: 14 }}>
        <View>
          <AppText variant="caption" color={colors.textMuted} style={{ fontSize: 12, fontWeight: '600' }}>{t("Départ")}</AppText>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>{from}</AppText>
        </View>
        <View>
          <AppText variant="caption" color={colors.textMuted} style={{ fontSize: 12, fontWeight: '600' }}>{t("Arrivée")}</AppText>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>{to}</AppText>
        </View>
      </View>
      {trailing ? <AppText variant="label" color={colors.textSecondary} style={{ alignSelf: 'center' }}>{trailing}</AppText> : null}
    </View>
  );
}

/** Centered message with an icon and up to two actions (empty states). */
export function EmptyState({ icon, title, message, action }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: spacing.xl, gap: 10 }}>
      <View style={styles.bigIcon}><Ionicons name={icon} size={32} color={colors.primaryText} /></View>
      <AppText variant="heading" style={{ fontSize: 20, textAlign: 'center' }}>{title}</AppText>
      {message ? <AppText color={colors.textSecondary} style={{ textAlign: 'center', fontSize: 15 }}>{message}</AppText> : null}
      {action ? <Button {...action} size="md" style={{ marginTop: 12, paddingHorizontal: 28 }} /> : null}
    </View>
  );
}

/** Bottom sheet dialog with a title (options, pickers). Tapping outside closes it. */
export function ModalSheet({ visible, onClose, title, children }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.dim}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t("Fermer")} />
        <SafeAreaView edges={['bottom']} style={[styles.panel, { alignItems: 'stretch', gap: 12, maxHeight: '88%' }]}>
          <View style={styles.row}>
            <AppText variant="heading" style={{ flex: 1 }} accessibilityRole="header">{title}</AppText>
            <IconButton icon="close" label={t("Fermer")} plain onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>{children}</ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Bottom-sheet dialog over a dimmed screen — ride problems (no drivers,
 * driver cancelled).
 */
export function StatusPanel({ icon = 'alert-circle-outline', title, message, primary, secondary, visible = true }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.dim}>
        <SafeAreaView edges={['bottom']} style={styles.panel}>
          <View style={[styles.bigIcon, { width: 72, height: 72, borderRadius: 36, marginBottom: 6 }]}>
            <Ionicons name={icon} size={34} color={colors.primaryText} />
          </View>
          <AppText variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">{title}</AppText>
          {message ? <AppText color={colors.textSecondary} style={{ textAlign: 'center', fontSize: 15, marginBottom: 14 }}>{message}</AppText> : null}
          {primary ? <Button {...primary} style={{ alignSelf: 'stretch' }} /> : null}
          {secondary ? <Button variant="ghost" size="sm" {...secondary} style={{ alignSelf: 'stretch' }} /> : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, height: 56 },
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.xl, paddingTop: 10, paddingBottom: spacing.xl, gap: spacing.lg, ...shadow.sheet,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.handle },
  input: {
    height: 54, backgroundColor: colors.background, color: colors.text, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.lg, fontSize: 16,
  },
  errorBanner: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.errorSoft },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: spacing.lg, minHeight: 58, paddingVertical: 10 },
  listRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  route: { flexDirection: 'row', gap: 12, padding: 14, paddingHorizontal: 16, borderRadius: radius.lg, backgroundColor: colors.background },
  bigIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dim: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  panel: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.xxl, paddingTop: 28, paddingBottom: 12, alignItems: 'center', gap: 10,
  },
}));
