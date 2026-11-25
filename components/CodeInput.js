// Four-digit code (pickup PIN, delivery code): one real text field drawn as
// four boxes, so paste, delete and the number pad all work normally.
import React, { useRef } from "react";
import { View, TextInput, Pressable } from "react-native";
import { AppText } from "./ui";
import { useTheme } from "../context/ThemeContext";
import { radius } from "../constants/theme";

export default function CodeInput({ value, onChange, label, error, length = 4 }) {
  const { colors } = useTheme();
  const input = useRef(null);
  const digits = (value || "").split("");
  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityRole="none">
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={length}
        accessibilityLabel={label}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <View style={{ flexDirection: "row", gap: 10 }} importantForAccessibility="no-hide-descendants">
        {Array.from({ length }).map((_, i) => {
          const filled = i < digits.length;
          const current = i === digits.length;
          return (
            <View key={i} style={{
              flex: 1, height: 64, borderRadius: radius.lg, alignItems: "center", justifyContent: "center",
              borderWidth: filled || current ? 2 : 1.5,
              borderColor: error ? colors.error : filled ? colors.text : current ? colors.primary : colors.border,
              backgroundColor: current ? colors.primaryTint : filled ? colors.surface : colors.surfaceRaised,
            }}>
              <AppText variant="title" style={{ fontSize: 26 }}>{digits[i] || ""}</AppText>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}
