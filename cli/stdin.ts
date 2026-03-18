/**
 * Orion CLI - Stdin / Pipe Support
 * Enables Unix pipe integration: cat file.ts | orion ask "What's wrong?"
 */

/**
 * Read all data from stdin if it's being piped (not a TTY).
 * Returns null if stdin is a TTY (interactive terminal) or no data arrives.
 */
export async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { resolve(data || null); });
    // Timeout after 1s if no data
    setTimeout(() => { if (!data) resolve(null); }, 1000);
  });
}
