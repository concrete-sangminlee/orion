/**
 * Orion CLI - Security Vulnerability Scanner Command
 * AI-powered security analysis for common vulnerabilities:
 * SQL injection, XSS, hardcoded secrets, insecure crypto, path traversal, command injection
 *
 * Usage:
 *   orion security src/                    # Scan directory for security issues
 *   orion security src/api.ts              # Scan specific file
 *   orion security --owasp                 # Check OWASP Top 10
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  stopSpinner,
  detectLanguage,
  loadProjectContext,
} from '../utils.js';
import { createStreamHandler, readAndValidateFile, printCommandError } from '../shared.js';
import { commandHeader, statusLine, badge, divider, palette, table as uiTable } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.swift', '.kt', '.scala',
  '.sql', '.sh', '.bash',
  '.html', '.vue', '.svelte', '.astro',
  '.dart', '.ex', '.exs',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.cache', 'coverage', '.nyc_output', '.turbo',
  '.svelte-kit', '.output', 'target', 'vendor', '.venv', 'venv',
  'env', '.tox', '.eggs', '.orion',
]);

const MAX_FILE_SIZE = 512 * 1024; // 512 KB
const MAX_FILES = 200;

// ─── Security Patterns (pre-scan heuristics) ────────────────────────────────

interface SecurityPattern {
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  pattern: RegExp;
  description: string;
  category: string;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  // SQL Injection
  {
    name: 'SQL Injection (string concat)',
    severity: 'CRITICAL',
    pattern: /(?:query|execute|exec|raw)\s*\(\s*[`"'].*?\$\{|(?:query|execute|exec|raw)\s*\(\s*(?:["'].*?\+|.*?\+\s*["'])/gi,
    description: 'SQL query built with string concatenation or template literals',
    category: 'SQL Injection',
  },
  {
    name: 'SQL Injection (f-string / format)',
    severity: 'CRITICAL',
    pattern: /(?:cursor\.execute|\.query|\.raw)\s*\(\s*f["']|\.format\s*\(.*?\).*?(?:SELECT|INSERT|UPDATE|DELETE)/gi,
    description: 'SQL query using Python f-strings or .format()',
    category: 'SQL Injection',
  },

  // XSS
  {
    name: 'Cross-Site Scripting (innerHTML)',
    severity: 'HIGH',
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML|v-html\s*=|document\.write\s*\(/gi,
    description: 'Directly setting innerHTML or using dangerous HTML insertion',
    category: 'XSS',
  },

  // Hardcoded Secrets
  {
    name: 'Hardcoded API Key',
    severity: 'CRITICAL',
    pattern: /(?:api[_-]?key|apikey|secret[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}/gi,
    description: 'Hardcoded API key, secret, or token in source code',
    category: 'Hardcoded Secrets',
  },
  {
    name: 'Hardcoded Password',
    severity: 'CRITICAL',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}/gi,
    description: 'Hardcoded password in source code',
    category: 'Hardcoded Secrets',
  },
  {
    name: 'AWS Credentials',
    severity: 'CRITICAL',
    pattern: /AKIA[0-9A-Z]{16}|(?:aws_secret_access_key|aws_access_key_id)\s*[:=]\s*["'][A-Za-z0-9\/+=]{20,}/gi,
    description: 'AWS access key or secret key found in source code',
    category: 'Hardcoded Secrets',
  },

  // Insecure Crypto
  {
    name: 'Weak Hash Algorithm (MD5/SHA1)',
    severity: 'MEDIUM',
    pattern: /(?:createHash|hashlib\.)\s*\(\s*["'](?:md5|sha1)["']\)|MD5\s*\(|SHA1\s*\(/gi,
    description: 'Use of weak hashing algorithms (MD5, SHA1) for security purposes',
    category: 'Insecure Crypto',
  },
  {
    name: 'Insecure Random',
    severity: 'MEDIUM',
    pattern: /Math\.random\s*\(\)|random\.random\s*\(\)|rand\s*\(\)/gi,
    description: 'Use of non-cryptographic random number generator for security-sensitive operations',
    category: 'Insecure Crypto',
  },

  // Path Traversal
  {
    name: 'Path Traversal',
    severity: 'HIGH',
    pattern: /(?:readFile|readFileSync|open|createReadStream)\s*\(.*?(?:req\.|params\.|query\.|body\.)|path\.join\s*\(.*?(?:req\.|params\.|query\.|body\.)/gi,
    description: 'File access using unsanitized user input',
    category: 'Path Traversal',
  },

  // Command Injection
  {
    name: 'Command Injection',
    severity: 'CRITICAL',
    pattern: /(?:exec|execSync|spawn|system|popen|subprocess\.call|subprocess\.run|os\.system)\s*\(.*?(?:req\.|params\.|query\.|body\.|\$\{|`.*?\+)/gi,
    description: 'Shell command execution with unsanitized user input',
    category: 'Command Injection',
  },
  {
    name: 'Eval Usage',
    severity: 'HIGH',
    pattern: /\beval\s*\(|new\s+Function\s*\(/gi,
    description: 'Use of eval() or new Function() can execute arbitrary code',
    category: 'Command Injection',
  },

  // Miscellaneous
  {
    name: 'Disabled TLS Verification',
    severity: 'HIGH',
    pattern: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/gi,
    description: 'TLS/SSL certificate verification is disabled',
    category: 'Insecure Configuration',
  },
  {
    name: 'CORS Wildcard',
    severity: 'MEDIUM',
    pattern: /Access-Control-Allow-Origin['":\s]+\*|cors\(\s*\)|origin:\s*(?:true|\*|['"]?\*['"]?)/gi,
    description: 'CORS configured with wildcard origin, allowing any domain',
    category: 'Insecure Configuration',
  },
  {
    name: 'Hardcoded IP / Localhost Binding',
    severity: 'LOW',
    pattern: /(?:listen|bind)\s*\(\s*(?:["']0\.0\.0\.0["']|0\.0\.0\.0)/gi,
    description: 'Server binding to all interfaces (0.0.0.0)',
    category: 'Insecure Configuration',
  },
];

// ─── OWASP Top 10 Categories ────────────────────────────────────────────────

const OWASP_TOP_10 = [
  'A01:2021 - Broken Access Control',
  'A02:2021 - Cryptographic Failures',
  'A03:2021 - Injection',
  'A04:2021 - Insecure Design',
  'A05:2021 - Security Misconfiguration',
  'A06:2021 - Vulnerable and Outdated Components',
  'A07:2021 - Identification and Authentication Failures',
  'A08:2021 - Software and Data Integrity Failures',
  'A09:2021 - Security Logging and Monitoring Failures',
  'A10:2021 - Server-Side Request Forgery (SSRF)',
];

// ─── System Prompts ─────────────────────────────────────────────────────────

const SECURITY_SYSTEM_PROMPT = `You are Orion, an expert application security auditor. Analyze the provided code for security vulnerabilities.

For each finding, use this exact format:
[CRITICAL] <title>: <description and remediation>
[HIGH] <title>: <description and remediation>
[MEDIUM] <title>: <description and remediation>
[LOW] <title>: <description and remediation>

Categories to check:
- SQL Injection (parameterized queries, ORM usage)
- Cross-Site Scripting (XSS) (output encoding, CSP)
- Hardcoded Secrets (API keys, passwords, tokens)
- Insecure Cryptography (weak algorithms, poor key management)
- Path Traversal (file access with user input)
- Command Injection (shell execution with user input)
- Authentication / Authorization flaws
- Insecure deserialization
- Missing input validation
- Information disclosure

For each vulnerability:
1. Reference the exact line number and code snippet
2. Explain the attack vector
3. Provide a concrete fix with code example

End with a Security Score (1-10) and a summary of critical findings.
Be thorough but avoid false positives. Focus on real, exploitable issues.`;

const OWASP_SYSTEM_PROMPT = `You are Orion, an expert application security auditor specializing in the OWASP Top 10 (2021).

Analyze the provided code against each OWASP Top 10 category:
${OWASP_TOP_10.map(c => `- ${c}`).join('\n')}

For each applicable category, report findings using this format:
[CRITICAL] <OWASP Category> - <title>: <description and remediation>
[HIGH] <OWASP Category> - <title>: <description and remediation>
[MEDIUM] <OWASP Category> - <title>: <description and remediation>
[LOW] <OWASP Category> - <title>: <description and remediation>

If a category has no findings, note it as PASS.
Provide specific line references and concrete remediation code.

End with:
- OWASP Compliance Summary (which categories pass/fail)
- Overall risk rating (Critical/High/Medium/Low)
- Top 3 priority fixes`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SecurityScanResult {
  file: string;
  line: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  name: string;
  description: string;
  category: string;
  snippet: string;
}

export interface SecurityOptions {
  owasp?: boolean;
}

// ─── File Discovery ─────────────────────────────────────────────────────────

function discoverFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string, depth: number): void {
    if (depth > 6 || files.length >= MAX_FILES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;

      const name = entry.name;
      if (name.startsWith('.') && name !== '.env') continue;

      const fullPath = path.join(currentDir, name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) {
          walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (SCANNABLE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              files.push(fullPath);
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  walk(dir, 0);
  return files;
}

// ─── Pattern Scanner ────────────────────────────────────────────────────────

function scanFileForPatterns(filePath: string): SecurityScanResult[] {
  const results: SecurityScanResult[] = [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return results;
  }

  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of SECURITY_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.pattern.lastIndex = 0;
      if (pattern.pattern.test(line)) {
        pattern.pattern.lastIndex = 0;
        results.push({
          file: filePath,
          line: i + 1,
          severity: pattern.severity,
          name: pattern.name,
          description: pattern.description,
          category: pattern.category,
          snippet: line.trim(),
        });
      }
    }
  }

  return results;
}

// ─── Severity Helpers ───────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MEDIUM: '#F59E0B',
  LOW: '#3B82F6',
};

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function severityBadge(level: string): string {
  const color = SEVERITY_COLORS[level] || '#7C5CFC';
  return badge(level, color);
}

// ─── Display Results ────────────────────────────────────────────────────────

function displayScanResults(results: SecurityScanResult[]): void {
  if (results.length === 0) {
    console.log(statusLine('\u2713', palette.green('No security issues detected by pattern scanner')));
    console.log();
    return;
  }

  // Sort by severity
  results.sort((a, b) => (SEVERITY_ORDER[a.severity] || 4) - (SEVERITY_ORDER[b.severity] || 4));

  // Summary counts
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.severity] = (counts[r.severity] || 0) + 1;
  }

  const summaryParts: string[] = [];
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    if (counts[sev]) {
      summaryParts.push(`${severityBadge(sev)} ${counts[sev]}`);
    }
  }
  console.log(`  ${summaryParts.join('  ')}`);
  console.log();

  // Group by file
  const byFile = new Map<string, SecurityScanResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.file) || [];
    existing.push(r);
    byFile.set(r.file, existing);
  }

  const cwd = process.cwd();
  for (const [file, fileResults] of byFile) {
    const relPath = path.relative(cwd, file);
    console.log(`  ${colors.file(relPath)}`);
    for (const r of fileResults) {
      console.log(`    ${severityBadge(r.severity)} Line ${r.line}: ${palette.white(r.name)}`);
      console.log(`      ${palette.dim(r.description)}`);
      console.log(`      ${palette.dim(r.snippet.substring(0, 100))}`);
    }
    console.log();
  }
}

// ─── AI Security Audit ──────────────────────────────────────────────────────

function buildCodePayload(files: string[]): string {
  const cwd = process.cwd();
  const parts: string[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const relPath = path.relative(cwd, file);
    const lang = detectLanguage(file);
    parts.push(`--- ${relPath} (${lang}) ---\n\`\`\`${lang}\n${content}\n\`\`\``);
  }

  return parts.join('\n\n');
}

function colorizeSecurityOutput(text: string): void {
  const lines = text.split('\n');
  const nonSeverityLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    const severityMatch = trimmed.match(/^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*(.*)/);
    if (severityMatch) {
      // Flush accumulated text as markdown
      if (nonSeverityLines.length > 0) {
        const mdBlock = nonSeverityLines.join('\n');
        if (mdBlock.trim()) {
          console.log(renderMarkdown(mdBlock));
        }
        nonSeverityLines.length = 0;
      }

      const sev = severityMatch[1];
      const rest = severityMatch[2];
      console.log(`  ${severityBadge(sev)} ${rest}`);
    } else {
      nonSeverityLines.push(line);
    }
  }

  // Flush remaining text
  if (nonSeverityLines.length > 0) {
    const mdBlock = nonSeverityLines.join('\n');
    if (mdBlock.trim()) {
      console.log(renderMarkdown(mdBlock));
    }
  }
}

// ─── Command Entry Points ───────────────────────────────────────────────────

async function scanTarget(target: string, options: SecurityOptions): Promise<void> {
  const resolvedTarget = path.resolve(target);

  let files: string[] = [];
  let isDirectory = false;

  try {
    const stat = fs.statSync(resolvedTarget);
    isDirectory = stat.isDirectory();
  } catch {
    console.log();
    console.log(`  ${colors.error('Target not found:')} ${resolvedTarget}`);
    console.log(`  ${palette.dim('Provide a valid file or directory path.')}`);
    console.log();
    return;
  }

  if (isDirectory) {
    const scanSpinner = startSpinner('Scanning directory for files...');
    files = discoverFiles(resolvedTarget);
    scanSpinner.succeed(palette.green(`Found ${files.length} scannable files`));
  } else {
    const validated = readAndValidateFile(target);
    if (!validated) return;
    files = [resolvedTarget];
  }

  if (files.length === 0) {
    console.log();
    console.log(`  ${palette.dim('No scannable files found.')}`);
    console.log();
    return;
  }

  // Phase 1: Pattern-based scan
  console.log();
  console.log(`  ${palette.violet.bold('Phase 1: Pattern Scanner')}`);
  console.log(divider());

  const patternSpinner = startSpinner('Running pattern-based security scan...');
  const allResults: SecurityScanResult[] = [];

  for (const file of files) {
    const results = scanFileForPatterns(file);
    allResults.push(...results);
  }

  if (allResults.length > 0) {
    patternSpinner.succeed(palette.yellow(`Found ${allResults.length} potential issue(s)`));
  } else {
    patternSpinner.succeed(palette.green('No pattern-based issues detected'));
  }
  console.log();
  displayScanResults(allResults);

  // Phase 2: AI deep analysis
  console.log(`  ${palette.violet.bold('Phase 2: AI Security Audit')}`);
  console.log(divider());

  // Limit files sent to AI to avoid token overflow
  const filesToAnalyze = files.slice(0, 15);
  const codePayload = buildCodePayload(filesToAnalyze);

  if (!codePayload.trim()) {
    console.log(`  ${palette.dim('No code to analyze.')}`);
    console.log();
    return;
  }

  const systemPrompt = options.owasp ? OWASP_SYSTEM_PROMPT : SECURITY_SYSTEM_PROMPT;
  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? systemPrompt + '\n\nProject context:\n' + projectContext
    : systemPrompt;

  const userMessage = options.owasp
    ? `Perform an OWASP Top 10 security audit on the following code:\n\n${codePayload}`
    : `Perform a security audit on the following code:\n\n${codePayload}`;

  const aiSpinner = startSpinner('Running AI security analysis...');

  try {
    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        stopSpinner(aiSpinner);
        console.log();
        colorizeSecurityOutput(text);
        console.log();
      },
      onError(error: Error) {
        stopSpinner(aiSpinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(aiSpinner, err.message, false);
    printCommandError(err, 'security', 'Run `orion config` to check your AI provider settings.');
  }
}

async function owaspScan(): Promise<void> {
  // Scan current directory with OWASP mode
  const cwd = process.cwd();

  console.log(commandHeader('Orion Security Scanner', [
    ['Mode', 'OWASP Top 10 Audit'],
    ['Directory', cwd],
  ]));

  await scanTarget(cwd, { owasp: true });
}

export async function securityCommand(target?: string, options: SecurityOptions = {}): Promise<void> {
  if (options.owasp && !target) {
    await owaspScan();
    return;
  }

  const scanTarget_ = target || process.cwd();
  const resolvedTarget = path.resolve(scanTarget_);

  let modeLabel = 'Security Scan';
  if (options.owasp) modeLabel = 'OWASP Top 10 Audit';

  const isDir = fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory();

  console.log(commandHeader('Orion Security Scanner', [
    ['Mode', modeLabel],
    [isDir ? 'Directory' : 'File', resolvedTarget],
  ]));

  await scanTarget(scanTarget_, options);
}
