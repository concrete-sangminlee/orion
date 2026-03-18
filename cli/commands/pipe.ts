/**
 * Orion CLI - Pipe Support Utilities
 * Enables orion to work as a Unix pipe:
 *   cat error.log | orion ask "What's wrong here?"
 *   git diff | orion review
 *   cat app.ts | orion explain
 *
 * Detects stdin pipe via process.stdin.isTTY and reads all piped data.
 */

// ─── Pipe Detection ──────────────────────────────────────────────────────────

/**
 * Check if stdin has piped data available (not a TTY).
 */
export function hasPipedInput(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Read all data from stdin pipe.
 * Returns empty string if stdin is a TTY (no pipe).
 * Includes a timeout to prevent hanging if no data arrives.
 */
export async function readPipedInput(timeoutMs: number = 5000): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise<string>((resolve) => {
    let data = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        resolve(data);
      }
    }, timeoutMs);

    process.stdin.setEncoding('utf-8');
    process.stdin.resume();

    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(data);
      }
    });

    process.stdin.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(data);
      }
    });
  });
}

/**
 * Build a prompt context string from piped input.
 * Wraps the piped data in a code block for AI consumption.
 */
export function buildPipedContext(pipedData: string, question?: string): string {
  if (!pipedData.trim()) {
    return question || '';
  }

  const lines: string[] = [];

  if (question) {
    lines.push(question);
    lines.push('');
  }

  lines.push('Here is the piped input:');
  lines.push('');
  lines.push('```');
  lines.push(pipedData.trim());
  lines.push('```');

  return lines.join('\n');
}

/**
 * Build a review context from piped input (e.g., git diff | orion review).
 */
export function buildPipedReviewContext(pipedData: string): string {
  if (!pipedData.trim()) {
    return '';
  }

  return `Review the following code/diff:\n\n\`\`\`\n${pipedData.trim()}\n\`\`\``;
}

/**
 * Build an explain context from piped input (e.g., cat file.ts | orion explain).
 */
export function buildPipedExplainContext(pipedData: string): string {
  if (!pipedData.trim()) {
    return '';
  }

  return `Explain the following code:\n\n\`\`\`\n${pipedData.trim()}\n\`\`\``;
}
