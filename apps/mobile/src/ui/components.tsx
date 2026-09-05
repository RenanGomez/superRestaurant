import { useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { colors, radius, spacing, touchTarget, typography } from "./theme.js";

/**
 * True when the operating system asks for reduced motion. The app has no
 * decorative animation; the only moving element is the activity indicator,
 * which is replaced by static text when this is on.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => { setReduced(value); });
    return (): void => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

/**
 * Visible keyboard focus for pressable controls.
 *
 * `Pressable` only reports `pressed` to its style callback, and react-native-web
 * removes the browser outline, so a focused button would otherwise show nothing.
 * Tracking focus explicitly keeps the ring visible on every runtime that has a
 * keyboard and costs nothing on a touch-only device.
 */
export function useFocusRing(): {
  readonly focused: boolean;
  readonly handlers: { readonly onBlur: () => void; readonly onFocus: () => void };
} {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    handlers: { onBlur: (): void => { setFocused(false); }, onFocus: (): void => { setFocused(true); } },
  };
}

export function Heading({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>;
}

export function Subheading({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <Text accessibilityRole="header" style={styles.subheading}>{children}</Text>;
}

export function Body({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <Text style={styles.body}>{children}</Text>;
}

export function Caption({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <Text style={styles.caption}>{children}</Text>;
}

export function Card({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <View style={styles.card}>{children}</View>;
}

export function ActionButton({ accessibilityHint, busy = false, disabled = false, label, onPress, tone = "primary" }: {
  readonly accessibilityHint?: string;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "primary" | "secondary";
}): React.JSX.Element {
  const inactive = disabled || busy;
  const focus = useFocusRing();
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ busy, disabled: inactive }}
    {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
    disabled={inactive}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [
      styles.button,
      tone === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
      inactive && styles.buttonInactive,
      (state.pressed || focus.focused) && styles.buttonFocused,
    ]}
  >
    <Text style={[styles.buttonLabel, tone === "primary" ? styles.buttonLabelPrimary : styles.buttonLabelSecondary]}>
      {label}
    </Text>
  </Pressable>;
}

export function Banner({ message, tone }: {
  readonly message: string;
  readonly tone: "error" | "info";
}): React.JSX.Element {
  return <View
    accessibilityLiveRegion="polite"
    accessibilityRole="alert"
    style={[styles.banner, tone === "error" ? styles.bannerError : styles.bannerInfo]}
  >
    <Text style={[styles.body, tone === "error" ? styles.bannerErrorText : styles.bannerInfoText]}>{message}</Text>
  </View>;
}

export function LoadingBlock({ label }: { readonly label: string }): React.JSX.Element {
  const reduced = useReducedMotion();
  return <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.block}>
    {reduced ? null : <ActivityIndicator color={colors.accent} size="large" />}
    <Text style={styles.body}>{label}</Text>
  </View>;
}

export function StateBlock({ action, description, title }: {
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly description: string;
  readonly title: string;
}): React.JSX.Element {
  return <View style={styles.block}>
    <Subheading>{title}</Subheading>
    <Body>{description}</Body>
    {action === undefined ? null : <ActionButton label={action.label} onPress={action.onPress} tone="secondary" />}
  </View>;
}

export function Field({ label, ...input }: { readonly label: string } & TextInputProps): React.JSX.Element {
  return <View style={styles.field}>
    <Text nativeID={`label-${label}`} style={styles.caption}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      accessibilityLabelledBy={`label-${label}`}
      placeholderTextColor={colors.disabled}
      style={styles.input}
      {...input}
    />
  </View>;
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.control,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  bannerError: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  bannerErrorText: { color: colors.danger },
  bannerInfo: { backgroundColor: colors.infoSurface, borderColor: colors.info },
  bannerInfoText: { color: colors.info },
  block: {
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  body: { color: colors.text, ...typography.body },
  button: {
    alignItems: "center",
    borderRadius: radius.control,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonFocused: { borderColor: colors.focus, borderWidth: 3 },
  buttonInactive: { opacity: 0.6 },
  buttonLabel: { fontWeight: "600", ...typography.body },
  buttonLabelPrimary: { color: colors.accentText },
  buttonLabelSecondary: { color: colors.accent },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surface, borderColor: colors.accent },
  caption: { color: colors.textMuted, ...typography.caption },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  field: { gap: spacing.xs, marginBottom: spacing.md },
  heading: { color: colors.text, fontWeight: "700", ...typography.heading },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.text,
    minHeight: touchTarget.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
  subheading: { color: colors.text, fontWeight: "600", ...typography.subheading },
});
