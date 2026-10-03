/**
 * The environment variable a setting is filled from: the prefix, then the
 * camelCase name in capitals with underscores between its words.
 *
 * @example
 * envVarName("MYAPP_", "apiBaseUrl");  // "MYAPP_API_BASE_URL"
 * envVarName("", "httpTimeout");       // "HTTP_TIMEOUT"
 * envVarName("", "oauthClientID");     // "OAUTH_CLIENT_ID"
 */
export function envVarName(prefix: string, setting: string): string {
  const words = setting
    // "baseUrl" -> "base_Url", "v2Api" -> "v2_Api"
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // "HTTPTimeout" -> "HTTP_Timeout"
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2");
  return prefix + words.toUpperCase();
}
