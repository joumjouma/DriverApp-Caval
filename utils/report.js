// One place to report errors. Today: console. When Sentry is set up
// (@sentry/react-native + DSN), call Sentry.captureException here.
export function reportError(error, context = {}) {
  console.error("[Caval]", context.where || "error", error?.message || error, context);
}
