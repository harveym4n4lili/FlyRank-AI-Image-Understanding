import { logger } from "./logger.js";

// Failure alert for jobs that exhausted their retries: always logged at error level, and
// POSTed to ALERT_WEBHOOK_URL (e.g. a Slack/Discord incoming webhook) when one is configured.
export function createAlerter(webhookUrl?: string) {
  return async function alert(message: string, context: Record<string, unknown> = {}) {
    logger.error({ alert: true, ...context }, message);
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[image-matcher] ${message}`, context }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      logger.warn({ err }, "alert webhook failed");
    }
  };
}

export type Alert = ReturnType<typeof createAlerter>;
