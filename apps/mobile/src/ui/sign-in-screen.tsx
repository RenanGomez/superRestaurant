import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";

import type { MobileSignInResult } from "../auth-port.js";
import { ActionButton, Banner, Body, Caption, Field, Heading } from "./components.js";
import { colors, spacing } from "./theme.js";

const MESSAGES: Readonly<Record<Exclude<MobileSignInResult, "ok">, string>> = Object.freeze({
  rejected: "Correo o contraseña incorrectos.",
  unavailable: "No se pudo contactar al servicio de acceso. Revisa la red e inténtalo de nuevo.",
});

export function SignInScreen({ notice, onSignIn }: {
  readonly notice: string | undefined;
  readonly onSignIn: (email: string, password: string) => Promise<MobileSignInResult>;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<MobileSignInResult, "ok"> | undefined>(undefined);

  const submit = (): void => {
    if (busy || email.trim().length === 0 || password.length === 0) return;
    setBusy(true);
    setFailure(undefined);
    void onSignIn(email.trim(), password)
      .then((result) => { if (result !== "ok") setFailure(result); })
      .finally(() => { setBusy(false); });
  };

  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Caption>superRestaurant</Caption>
        <Heading>Acceso de operación</Heading>
        <Body>Ingresa con tu cuenta para ver las mesas y el menú de tu sucursal.</Body>

        {notice === undefined ? null : <View style={styles.notice}><Banner message={notice} tone="info" /></View>}
        {failure === undefined ? null : <View style={styles.notice}><Banner message={MESSAGES[failure]} tone="error" /></View>}

        <View style={styles.form}>
          <Field
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            label="Correo"
            onChangeText={setEmail}
            returnKeyType="next"
            textContentType="username"
            value={email}
          />
          <Field
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            label="Contraseña"
            onChangeText={setPassword}
            onSubmitEditing={submit}
            returnKeyType="go"
            secureTextEntry
            textContentType="password"
            value={password}
          />
          <ActionButton
            accessibilityHint="Valida tus credenciales con el servicio de acceso"
            busy={busy}
            disabled={email.trim().length === 0 || password.length === 0}
            label={busy ? "Ingresando…" : "Ingresar"}
            onPress={submit}
          />
        </View>

        <Caption>La sesión se guarda solo en memoria: al cerrar la aplicación deberás ingresar de nuevo.</Caption>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, maxWidth: 520, width: "100%" },
  content: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  flex: { backgroundColor: colors.background, flex: 1 },
  form: { marginTop: spacing.md, width: "100%" },
  notice: { marginTop: spacing.md, width: "100%" },
});
