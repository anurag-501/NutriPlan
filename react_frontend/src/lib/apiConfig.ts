export interface ApiBaseUrlConfig {
  baseUrl: string;
  error?: string;
}

const PRODUCTION_API_CONFIG_ERROR =
  "The NutriPlan API URL is not configured for production. Set VITE_API_BASE_URL to the deployed FastAPI HTTPS URL in Vercel.";

/**
 * In development, an empty base URL deliberately uses the Vite proxy.
 * A production build must have an explicit public HTTPS API origin and must
 * never fall back to the Vercel page origin or a developer's localhost.
 */
export function resolveApiBaseUrl(value: string | undefined, production: boolean): ApiBaseUrlConfig {
  const baseUrl = (value ?? "").trim().replace(/\/+$/, "");
  if (!production) return { baseUrl };
  if (!baseUrl) return { baseUrl: "", error: PRODUCTION_API_CONFIG_ERROR };

  try {
    const parsed = new URL(baseUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLoopback = hostname === "localhost"
      || hostname === "::1"
      || hostname === "0.0.0.0"
      || hostname.startsWith("127.")
      || hostname.startsWith("::ffff:127.");
    if (parsed.protocol !== "https:" || isLoopback || parsed.username || parsed.password) {
      return { baseUrl: "", error: PRODUCTION_API_CONFIG_ERROR };
    }
    return { baseUrl };
  } catch {
    return { baseUrl: "", error: PRODUCTION_API_CONFIG_ERROR };
  }
}
