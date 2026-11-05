import type { ApiKeyProvider } from './ipc-contract'

/**
 * Providers whose API keys the main process stores. `satisfies` keeps this
 * runtime list identical to the contract's `ApiKeyProvider` union.
 */
export const API_KEY_PROVIDERS = Object.keys({
  anthropic: true,
  openai: true,
  kimi: true,
  gemini: true,
  nvidia: true,
  custom: true,
} satisfies Record<ApiKeyProvider, true>) as readonly ApiKeyProvider[]

export function isApiKeyProvider(value: string): value is ApiKeyProvider {
  return (API_KEY_PROVIDERS as readonly string[]).includes(value)
}
