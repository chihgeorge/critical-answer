/**
 * Which browser pages may open a WebSocket to the Worker.
 *
 * `allowed` is a comma-separated list: an exact origin ("https://app.example.com"), "*" for any
 * (local dev only), or an origin with one "*" standing for a single hostname label
 * ("https://critical-answer-*.vercel.app" matches Vercel preview URLs of this project only).
 *
 * A request without an Origin header is not a browser page (tests, curl), so it is let through:
 * this check exists to stop other websites, not to authenticate clients.
 */
export function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return true;
  return allowed
    .split(",")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .some((rule) => rule === "*" || rule === origin || ruleRegExp(rule).test(origin));
}

function ruleRegExp(rule: string): RegExp {
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[A-Za-z0-9-]+");
  return new RegExp(`^${escaped}$`);
}
