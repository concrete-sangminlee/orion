/**
 * Orion CLI - CSV/JSON Data Helper Command
 * AI-powered data analysis, natural language queries, and format conversion.
 *
 * Usage:
 *   orion csv data.csv                              # AI analyzes CSV data
 *   orion csv data.csv --query "top 5 by revenue"   # Natural language query
 *   orion csv data.json --convert csv               # JSON to CSV conversion
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  loadProjectContext,
  printError,
  printInfo,
  printSuccess,
} from '../utils.js';
import { createStreamHandler, printCommandError } from '../shared.js';
import { commandHeader, divider, table as uiTable, palette, box } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DATA_SIZE = 50 * 1024; // 50KB for AI context
const MAX_PREVIEW_ROWS = 20;

// ─── System Prompts ──────────────────────────────────────────────────────────

const CSV_ANALYSIS_PROMPT = `You are Orion, an expert data analyst. Analyze the provided CSV/JSON data and give a comprehensive overview.

You MUST structure your response with these exact sections:

## Data Overview

| Property | Value |
|----------|-------|
| Rows | <count> |
| Columns | <count> |
| Data Types | <summary of column types> |

## Column Analysis

For each column:
- **<column_name>**: <type>, <unique count> unique values, <null count> nulls
  - Range/Distribution: <min-max for numbers, sample values for strings>

## Key Insights

1. <Insight about patterns, outliers, or notable features>
2. <Insight about data quality or completeness>
3. <Insight about correlations or trends>

## Data Quality

- **Completeness**: <percentage of non-null values>
- **Issues Found**: <duplicates, inconsistencies, formatting problems>
- **Recommendations**: <suggestions for data cleaning>

## Suggested Queries

- <natural language query suggestion 1>
- <natural language query suggestion 2>
- <natural language query suggestion 3>

Use markdown formatting. Be specific with numbers and examples from the actual data.`;

const CSV_QUERY_PROMPT = `You are Orion, an expert data analyst. Answer the user's natural language query about the provided data.

Rules:
- Provide a clear, direct answer to the question
- Show results in a markdown table when appropriate
- Include the reasoning/methodology used
- If the query requires computation (sum, average, count, etc.), show the work
- If the query is ambiguous, state your interpretation
- Always reference actual values from the data

Structure your response as:
## Answer
<direct answer with data>

## Methodology
<how you derived the answer>

## Additional Notes
<any caveats or related insights>`;

// ─── Data Parsing ────────────────────────────────────────────────────────────

interface ParsedData {
  format: 'csv' | 'json';
  headers: string[];
  rows: string[][];
  rawContent: string;
  totalRows: number;
}

function parseCSV(content: string): ParsedData {
  const lines = content.trim().split('\n');
  if (lines.length === 0) {
    return { format: 'csv', headers: [], rows: [], rawContent: content, totalRows: 0 };
  }

  // Simple CSV parser (handles quoted fields)
  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(parseLine);

  return {
    format: 'csv',
    headers,
    rows,
    rawContent: content,
    totalRows: rows.length,
  };
}

function parseJSON(content: string): ParsedData {
  const parsed = JSON.parse(content);
  let dataArray: any[];

  if (Array.isArray(parsed)) {
    dataArray = parsed;
  } else if (parsed && typeof parsed === 'object') {
    // Try to find an array property
    const arrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
    if (arrayKey) {
      dataArray = parsed[arrayKey];
    } else {
      dataArray = [parsed];
    }
  } else {
    throw new Error('JSON data must be an array or object with an array property.');
  }

  if (dataArray.length === 0) {
    return { format: 'json', headers: [], rows: [], rawContent: content, totalRows: 0 };
  }

  // Extract headers from first object
  const headers = Object.keys(dataArray[0]);
  const rows = dataArray.map(item =>
    headers.map(h => {
      const val = item[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    })
  );

  return {
    format: 'json',
    headers,
    rows,
    rawContent: content,
    totalRows: rows.length,
  };
}

function loadDataFile(filePath: string): ParsedData {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const ext = path.extname(resolvedPath).toLowerCase();

  if (ext === '.json') {
    return parseJSON(content);
  } else if (ext === '.csv' || ext === '.tsv') {
    return parseCSV(content);
  } else {
    // Try to detect format
    const trimmed = content.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return parseJSON(content);
    }
    return parseCSV(content);
  }
}

// ─── Format Conversion ──────────────────────────────────────────────────────

function convertToCSV(data: ParsedData): string {
  const escape = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  };

  const headerLine = data.headers.map(escape).join(',');
  const dataLines = data.rows.map(row => row.map(escape).join(','));
  return [headerLine, ...dataLines].join('\n');
}

function convertToJSON(data: ParsedData): string {
  const objects = data.rows.map(row => {
    const obj: Record<string, string> = {};
    data.headers.forEach((h, i) => {
      obj[h] = row[i] || '';
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

// ─── Preview Display ─────────────────────────────────────────────────────────

function showDataPreview(data: ParsedData, filePath: string): void {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  console.log(commandHeader('Orion Data Helper', [
    ['File', colors.file(path.resolve(filePath))],
    ['Format', data.format.toUpperCase()],
    ['Rows', String(data.totalRows)],
    ['Columns', String(data.headers.length)],
  ]));

  // Show column names
  if (data.headers.length > 0) {
    console.log(`  ${palette.violet.bold('Columns')}`);
    const colList = data.headers.map((h, i) => `  ${palette.dim(`${i + 1}.`)} ${palette.blue(h)}`);
    for (const col of colList) {
      console.log(col);
    }
    console.log();
  }

  // Show data preview table
  if (data.rows.length > 0) {
    console.log(divider('Preview'));
    console.log();

    const previewRows = data.rows.slice(0, MAX_PREVIEW_ROWS);
    const truncatedHeaders = data.headers.map(h =>
      h.length > 15 ? h.substring(0, 12) + '...' : h
    );

    const truncatedRows = previewRows.map(row =>
      row.map(cell => {
        const val = cell || '';
        return val.length > 20 ? val.substring(0, 17) + '...' : val;
      })
    );

    console.log(uiTable(truncatedHeaders, truncatedRows));

    if (data.totalRows > MAX_PREVIEW_ROWS) {
      console.log(`  ${palette.dim(`... and ${data.totalRows - MAX_PREVIEW_ROWS} more rows`)}`);
    }
    console.log();
  }
}

// ─── AI Analysis ─────────────────────────────────────────────────────────────

async function analyzeData(data: ParsedData, filePath: string): Promise<void> {
  showDataPreview(data, filePath);

  console.log(divider('AI Analysis'));
  console.log();

  const spinner = startSpinner('AI is analyzing your data...');

  // Prepare data for AI (truncate if needed)
  let dataForAI = data.rawContent;
  if (dataForAI.length > MAX_DATA_SIZE) {
    dataForAI = dataForAI.substring(0, MAX_DATA_SIZE);
  }

  const userMessage =
    `Analyze this ${data.format.toUpperCase()} data (${data.totalRows} rows, ${data.headers.length} columns):\n` +
    `Columns: ${data.headers.join(', ')}\n\n` +
    `\`\`\`${data.format}\n${dataForAI}\n\`\`\``;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(CSV_ANALYSIS_PROMPT, userMessage, callbacks);

    jsonOutput('csv-analyze', {
      file: path.resolve(filePath),
      format: data.format,
      rows: data.totalRows,
      columns: data.headers.length,
      headers: data.headers,
      analysis: getResponse(),
    });
  } catch (err: any) {
    printCommandError(err, 'csv', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Natural Language Query ──────────────────────────────────────────────────

async function queryData(data: ParsedData, filePath: string, query: string): Promise<void> {
  showDataPreview(data, filePath);

  console.log(divider('Query'));
  console.log();
  console.log(`  ${palette.violet.bold('Q:')} ${query}`);
  console.log();

  const spinner = startSpinner('AI is querying your data...');

  let dataForAI = data.rawContent;
  if (dataForAI.length > MAX_DATA_SIZE) {
    dataForAI = dataForAI.substring(0, MAX_DATA_SIZE);
  }

  const userMessage =
    `Data (${data.format.toUpperCase()}, ${data.totalRows} rows, columns: ${data.headers.join(', ')}):\n\n` +
    `\`\`\`${data.format}\n${dataForAI}\n\`\`\`\n\n` +
    `Question: ${query}`;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(CSV_QUERY_PROMPT, userMessage, callbacks);

    jsonOutput('csv-query', {
      file: path.resolve(filePath),
      query,
      answer: getResponse(),
    });
  } catch (err: any) {
    printCommandError(err, 'csv', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Convert Mode ────────────────────────────────────────────────────────────

function convertData(data: ParsedData, filePath: string, targetFormat: string): void {
  const resolvedPath = path.resolve(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const dir = path.dirname(resolvedPath);

  let output: string;
  let outputExt: string;

  if (targetFormat === 'csv') {
    output = convertToCSV(data);
    outputExt = '.csv';
  } else if (targetFormat === 'json') {
    output = convertToJSON(data);
    outputExt = '.json';
  } else {
    printError(`Unknown target format: ${targetFormat}. Supported: csv, json`);
    process.exit(1);
    return;
  }

  if (data.format === targetFormat) {
    printError(`File is already in ${targetFormat.toUpperCase()} format.`);
    process.exit(1);
    return;
  }

  const outputPath = path.join(dir, baseName + outputExt);

  console.log(commandHeader('Orion Data Converter', [
    ['Source', colors.file(resolvedPath)],
    ['Format', `${data.format.toUpperCase()} -> ${targetFormat.toUpperCase()}`],
    ['Rows', String(data.totalRows)],
    ['Columns', String(data.headers.length)],
  ]));

  fs.writeFileSync(outputPath, output, 'utf-8');

  const sizeKB = (Buffer.byteLength(output, 'utf-8') / 1024).toFixed(1);
  printSuccess(`Converted ${data.totalRows} rows to ${targetFormat.toUpperCase()}`);
  printInfo(`Output: ${colors.file(outputPath)} (${sizeKB}KB)`);
  console.log();

  jsonOutput('csv-convert', {
    source: resolvedPath,
    output: outputPath,
    fromFormat: data.format,
    toFormat: targetFormat,
    rows: data.totalRows,
    columns: data.headers.length,
  });
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export interface CsvCommandOptions {
  query?: string;
  convert?: string;
}

export async function csvCommand(
  file?: string,
  options: CsvCommandOptions = {}
): Promise<void> {
  if (!file) {
    console.log();
    printError('Please provide a data file path.');
    console.log();
    console.log(`  ${palette.violet.bold('Usage:')}`);
    console.log(`  ${palette.dim('  orion csv data.csv                              # AI analyzes CSV data')}`);
    console.log(`  ${palette.dim('  orion csv data.csv --query "top 5 by revenue"   # Natural language query')}`);
    console.log(`  ${palette.dim('  orion csv data.json --convert csv               # JSON to CSV conversion')}`);
    console.log(`  ${palette.dim('  orion csv data.json --convert json              # CSV to JSON conversion')}`);
    console.log();
    process.exit(1);
  }

  // Load and parse the data file
  let data: ParsedData;
  try {
    data = loadDataFile(file);
  } catch (err: any) {
    printError(err.message || 'Failed to parse data file.');
    console.log();
    process.exit(1);
    return;
  }

  if (data.rows.length === 0 && data.headers.length === 0) {
    printError('The data file appears to be empty.');
    console.log();
    process.exit(1);
    return;
  }

  // Route to the appropriate mode
  if (options.convert) {
    convertData(data, file, options.convert.toLowerCase());
  } else if (options.query) {
    await queryData(data, file, options.query);
  } else {
    await analyzeData(data, file);
  }
}
