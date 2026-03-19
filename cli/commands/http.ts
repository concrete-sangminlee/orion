/**
 * Orion CLI - HTTP Request Helper Command
 * Make HTTP requests from the terminal with formatted output and AI curl conversion.
 *
 * Usage:
 *   orion http GET https://api.example.com/users              # Make GET request
 *   orion http POST https://api.example.com/users --data '{"name":"test"}'
 *   orion http --curl "curl -X GET https://api.example.com"   # Convert curl to code
 */

import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  printError,
  printInfo,
  printSuccess,
  printWarning,
} from '../utils.js';
import { createStreamHandler, printCommandError } from '../shared.js';
import { commandHeader, divider, palette, box, badge } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const HTTP_TIMEOUT = 30000; // 30 seconds
const MAX_RESPONSE_SIZE = 100 * 1024; // 100KB display limit
const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ─── System Prompts ──────────────────────────────────────────────────────────

const CURL_CONVERT_PROMPT = `You are Orion, an expert developer assistant. Convert the provided curl command into clean, idiomatic code.

You MUST provide implementations in ALL three languages:

## JavaScript (fetch)

\`\`\`javascript
<modern fetch-based implementation with async/await, proper error handling>
\`\`\`

## Python (requests)

\`\`\`python
<clean implementation using the requests library with error handling>
\`\`\`

## Go (net/http)

\`\`\`go
<idiomatic Go implementation with proper error handling and defer>
\`\`\`

## Explanation

<Brief explanation of what the curl command does, including:
- HTTP method
- Headers being sent
- Body/payload details
- Authentication if present>

Rules:
- Include all headers from the curl command
- Handle request body correctly
- Add proper error handling in each language
- Use modern language features and idioms
- Include necessary imports`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  elapsed: number;
  size: number;
}

// ─── HTTP Status Helpers ─────────────────────────────────────────────────────

function getStatusColor(status: number): (text: string) => string {
  if (status >= 200 && status < 300) return palette.green;
  if (status >= 300 && status < 400) return palette.blue;
  if (status >= 400 && status < 500) return palette.yellow;
  return palette.red;
}

function getStatusBadge(status: number): string {
  if (status >= 200 && status < 300) return badge(`${status}`, '#22C55E');
  if (status >= 300 && status < 400) return badge(`${status}`, '#38BDF8');
  if (status >= 400 && status < 500) return badge(`${status}`, '#F59E0B');
  return badge(`${status}`, '#EF4444');
}

// ─── Request Execution ───────────────────────────────────────────────────────

async function executeRequest(
  method: string,
  url: string,
  options: { data?: string; headers?: Record<string, string> }
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

  const startTime = Date.now();

  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    signal: controller.signal,
    headers: {
      'User-Agent': 'Orion-CLI/2.0',
      ...(options.headers || {}),
    },
  };

  // Add body for non-GET methods
  if (options.data && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    fetchOptions.body = options.data;

    // Auto-detect content type if not set
    if (!options.headers?.['Content-Type'] && !options.headers?.['content-type']) {
      try {
        JSON.parse(options.data);
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      } catch {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'text/plain';
      }
    }
  }

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeout);

    const elapsed = Date.now() - startTime;
    const body = await response.text();

    // Collect response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get('content-type') || 'text/plain';

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: body.length > MAX_RESPONSE_SIZE ? body.substring(0, MAX_RESPONSE_SIZE) : body,
      contentType,
      elapsed,
      size: Buffer.byteLength(body, 'utf-8'),
    };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${HTTP_TIMEOUT / 1000}s`);
    }
    throw err;
  }
}

// ─── Response Display ────────────────────────────────────────────────────────

function formatResponseBody(body: string, contentType: string): string {
  // Try pretty-print JSON
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function displayResponse(method: string, url: string, response: HttpResponse): void {
  console.log(commandHeader('Orion HTTP', [
    ['Method', method.toUpperCase()],
    ['URL', colors.file(url)],
    ['Status', `${response.status} ${response.statusText}`],
    ['Time', `${response.elapsed}ms`],
    ['Size', formatSize(response.size)],
  ]));

  // Status line
  const statusColor = getStatusColor(response.status);
  console.log(`  ${getStatusBadge(response.status)} ${statusColor(`${response.statusText}`)}  ${palette.dim(`${response.elapsed}ms`)}`);
  console.log();

  // Response headers
  console.log(divider('Response Headers'));
  console.log();
  const importantHeaders = [
    'content-type', 'content-length', 'cache-control', 'etag',
    'x-request-id', 'x-ratelimit-remaining', 'server',
    'access-control-allow-origin', 'set-cookie',
  ];
  const headerEntries = Object.entries(response.headers);
  for (const [key, value] of headerEntries) {
    const isImportant = importantHeaders.includes(key.toLowerCase());
    const keyStr = isImportant ? palette.blue(key) : palette.dim(key);
    console.log(`  ${keyStr}: ${palette.dim(value)}`);
  }
  console.log();

  // Response body
  console.log(divider('Response Body'));
  console.log();

  if (!response.body || response.body.trim() === '') {
    console.log(`  ${palette.dim('(empty response body)')}`);
  } else {
    const formatted = formatResponseBody(response.body, response.contentType);
    const lines = formatted.split('\n');
    const maxLines = 100;

    for (const line of lines.slice(0, maxLines)) {
      console.log(`  ${palette.dim(line)}`);
    }

    if (lines.length > maxLines) {
      console.log();
      console.log(`  ${palette.yellow(`... truncated (showing ${maxLines} of ${lines.length} lines)`)}`);
    }
  }
  console.log();
}

// ─── Curl Conversion ─────────────────────────────────────────────────────────

async function convertCurl(curlCommand: string): Promise<void> {
  console.log(commandHeader('Orion Curl Converter'));

  console.log(`  ${palette.violet.bold('Input:')}`);
  console.log(`  ${palette.dim(curlCommand)}`);
  console.log();
  console.log(divider());
  console.log();

  const spinner = startSpinner('AI is converting curl command...');

  const userMessage = `Convert this curl command to code:\n\n\`\`\`bash\n${curlCommand}\n\`\`\``;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(CURL_CONVERT_PROMPT, userMessage, callbacks);

    jsonOutput('http-curl-convert', {
      curl: curlCommand,
      conversion: getResponse(),
    });
  } catch (err: any) {
    printCommandError(err, 'http', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Header Parsing ──────────────────────────────────────────────────────────

function parseHeaderArgs(headerArgs: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of headerArgs) {
    const colonIdx = h.indexOf(':');
    if (colonIdx > 0) {
      const key = h.substring(0, colonIdx).trim();
      const value = h.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export interface HttpCommandOptions {
  data?: string;
  header?: string[];
  curl?: string;
}

export async function httpCommand(
  method?: string,
  url?: string,
  options: HttpCommandOptions = {}
): Promise<void> {
  // Curl conversion mode
  if (options.curl) {
    await convertCurl(options.curl);
    return;
  }

  // Validate method and URL
  if (!method || !url) {
    console.log();
    printError('Please provide an HTTP method and URL.');
    console.log();
    console.log(`  ${palette.violet.bold('Usage:')}`);
    console.log(`  ${palette.dim('  orion http GET https://api.example.com/users')}`);
    console.log(`  ${palette.dim('  orion http POST https://api.example.com/users --data \'{"name":"test"}\'')}`);
    console.log(`  ${palette.dim('  orion http PUT https://api.example.com/users/1 --data \'{"name":"updated"}\'')}`);
    console.log(`  ${palette.dim('  orion http DELETE https://api.example.com/users/1')}`);
    console.log(`  ${palette.dim('  orion http GET https://api.example.com -H "Authorization: Bearer token"')}`);
    console.log(`  ${palette.dim('  orion http --curl "curl -X GET https://api.example.com"')}`);
    console.log();
    console.log(`  ${palette.violet.bold('Methods:')} ${SUPPORTED_METHODS.join(', ')}`);
    console.log();
    process.exit(1);
    return;
  }

  const upperMethod = method.toUpperCase();
  if (!SUPPORTED_METHODS.includes(upperMethod)) {
    printError(`Unsupported HTTP method: ${method}`);
    printInfo(`Supported methods: ${SUPPORTED_METHODS.join(', ')}`);
    console.log();
    process.exit(1);
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    printError(`Invalid URL: ${url}`);
    printInfo('URL must include the protocol (https:// or http://)');
    console.log();
    process.exit(1);
    return;
  }

  // Parse headers
  const headers = options.header ? parseHeaderArgs(options.header) : {};

  // Execute request
  const spinner = startSpinner(`${upperMethod} ${url}`);

  try {
    const response = await executeRequest(upperMethod, url, {
      data: options.data,
      headers,
    });

    spinner.succeed(palette.green(`${response.status} ${response.statusText} (${response.elapsed}ms)`));
    console.log();

    displayResponse(upperMethod, url, response);

    jsonOutput('http-request', {
      method: upperMethod,
      url,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: response.body,
      elapsed: response.elapsed,
      size: response.size,
    });
  } catch (err: any) {
    spinner.fail(palette.red(err.message || 'Request failed'));
    console.log();
    printError(err.message || 'Failed to make HTTP request.');

    if (err.message?.includes('ENOTFOUND')) {
      printInfo('Could not resolve hostname. Check the URL and your network connection.');
    } else if (err.message?.includes('ECONNREFUSED')) {
      printInfo('Connection refused. The server may be down or the port may be wrong.');
    } else if (err.message?.includes('timed out')) {
      printInfo(`Request timed out after ${HTTP_TIMEOUT / 1000}s. The server may be slow.`);
    }
    console.log();
    process.exit(1);
  }
}
