import { useTranslation } from "react-i18next";

import { humanizeProviderError } from "../../providers/humanizeError";

/** Maps a raw provider error to a friendly, actionable banner message. */
export function formatProviderError(
  raw: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const err = humanizeProviderError(raw);
  switch (err.kind) {
    case "rateLimit":
      return err.retrySeconds
        ? t("room.errors.rateLimitRetry", { seconds: err.retrySeconds })
        : t("room.errors.rateLimit");
    case "badKey":
      return t("room.errors.badKey");
    case "overloaded":
      return t("room.errors.overloaded");
    case "modelNotFound":
      return err.model
        ? t("room.errors.modelNotFound", { model: err.model })
        : t("room.errors.modelNotFoundGeneric");
    default:
      return t("room.errors.generic", { message: err.message });
  }
}

export function ChatErrorBanner({
  error,
  errorRetryable,
  retry,
  onDismiss,
}: {
  error: string;
  errorRetryable: boolean;
  retry: (() => void) | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation(["chat", "common", "memory"]);

  return (
    <div
      className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm sm:mx-8"
      style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
    >
      <span>
        {error === "no-connection"
          ? t("room.errors.noConnection")
          : error === "offline"
            ? t("room.errors.offline")
            : error === "empty-response"
              ? t("room.errors.emptyResponse")
              : formatProviderError(error, t)}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {errorRetryable && retry && (
          <button
            type="button"
            onClick={() => {
              onDismiss();
              retry();
            }}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--color-danger)", color: "var(--color-accent-contrast)" }}
          >
            {t("room.errors.retry")}
          </button>
        )}
        <button type="button" onClick={onDismiss} className="opacity-80 hover:opacity-100">
          {t("actions.close", { ns: "common" })}
        </button>
      </span>
    </div>
  );
}
