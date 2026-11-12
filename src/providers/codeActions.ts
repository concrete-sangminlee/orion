/**
 * Code Actions / Quick Fix provider for the Monaco editor.
 * Registers a CodeActionProvider that shows a lightbulb icon with fix suggestions
 * for TypeScript/JavaScript files.
 */
import type { Monaco } from '@monaco-editor/react'

/**
 * Register code action providers for TS/JS languages. Global to the Monaco
 * instance: call it once (see registerEditorProviders).
 */
export function registerCodeActionProviders(monaco: Monaco) {
  // Monaco ids: .tsx/.jsx models are typescript/javascript.
  const codeActionLanguages = ['typescript', 'javascript']

  for (const caLang of codeActionLanguages) {
    monaco.languages.registerCodeActionProvider(caLang, {
      provideCodeActions: (model, range) => {
        const actions: {
          title: string
          kind: string
          isPreferred?: boolean
          diagnostics?: any[]
          edit?: {
            edits: {
              resource: any
              versionId: undefined
              textEdit: { range: any; text: string }
            }[]
          }
          command?: { id: string; title: string; arguments?: any[] }
        }[] = []

        const lineNumber = range.startLineNumber
        const lineContent = model.getLineContent(lineNumber)
        const fullText = model.getValue()
        const totalLines = model.getLineCount()

        // ── Helpers ──────────────────────────────────────────────────
        const makeEdit = (
          startLine: number,
          startCol: number,
          endLine: number,
          endCol: number,
          text: string,
        ) => ({
          edits: [
            {
              resource: model.uri,
              versionId: undefined as undefined,
              textEdit: {
                range: new monaco.Range(startLine, startCol, endLine, endCol),
                text,
              },
            },
          ],
        })

        const makeMultiEdit = (
          ...textEdits: { startLine: number; startCol: number; endLine: number; endCol: number; text: string }[]
        ) => ({
          edits: textEdits.map((te) => ({
            resource: model.uri,
            versionId: undefined as undefined,
            textEdit: {
              range: new monaco.Range(te.startLine, te.startCol, te.endLine, te.endCol),
              text: te.text,
            },
          })),
        })

        const makeInsert = (line: number, col: number, text: string) =>
          makeEdit(line, col, line, col, text)

        /** Get leading whitespace of a given line number */
        const getIndent = (ln: number): string => {
          const c = model.getLineContent(ln)
          const m = c.match(/^(\s*)/)
          return m ? m[1] : ''
        }

        // Monaco asks with the editor's selection as the range.
        const currentSelection = range
        const hasSelection = !currentSelection.isEmpty()
        const selectedText = hasSelection ? model.getValueInRange(currentSelection!) : ''
        const trimmedSel = selectedText.trim()

        // ── 1. Missing semicolon ─────────────────────────────────────
        const trimmedLine = lineContent.trimEnd()
        if (
          trimmedLine.length > 0 &&
          !trimmedLine.endsWith(';') &&
          !trimmedLine.endsWith('{') &&
          !trimmedLine.endsWith('}') &&
          !trimmedLine.endsWith(',') &&
          !trimmedLine.endsWith('(') &&
          !trimmedLine.endsWith(':') &&
          !trimmedLine.endsWith('*/') &&
          !trimmedLine.startsWith('//') &&
          !trimmedLine.startsWith('*') &&
          !trimmedLine.startsWith('import ') &&
          !/^\s*(?:if|else|for|while|switch|try|catch|finally|do)\b/.test(trimmedLine) &&
          !/=>\s*$/.test(trimmedLine) &&
          /(?:const |let |var |return |throw |[a-zA-Z_$]\w*\s*\(.*\)\s*)$|[a-zA-Z0-9_$'")`\]]\s*$/.test(
            trimmedLine,
          )
        ) {
          actions.push({
            title: 'Add missing semicolon',
            kind: 'quickfix',
            isPreferred: true,
            edit: makeInsert(lineNumber, lineContent.length + 1, ';'),
          })
        }

        // ── 2. Convert var to let / const ────────────────────────────
        const varMatch = lineContent.match(/^(\s*)var\s+/)
        if (varMatch) {
          const startCol = varMatch[1].length + 1
          const endCol = startCol + 3
          actions.push({
            title: 'Convert var to const',
            kind: 'quickfix',
            isPreferred: true,
            edit: makeEdit(lineNumber, startCol, lineNumber, endCol, 'const'),
          })
          actions.push({
            title: 'Convert var to let',
            kind: 'quickfix',
            edit: makeEdit(lineNumber, startCol, lineNumber, endCol, 'let'),
          })
        }

        // ── 3. Remove console.log statement ──────────────────────────
        const consoleLogMatch = lineContent.match(
          /^(\s*)console\.(log|warn|error|info|debug)\s*\(/,
        )
        if (consoleLogMatch) {
          actions.push({
            title: `Remove console.${consoleLogMatch[2]} statement`,
            kind: 'quickfix',
            edit: makeEdit(lineNumber, 1, lineNumber + 1, 1, ''),
          })
        }

        // ── 4. Unused variable (prefix with _ or remove) ────────────
        const unusedVarMatch = lineContent.match(/^\s*(?:const|let|var)\s+(\w+)\s*=/)
        if (unusedVarMatch) {
          const varName = unusedVarMatch[1]
          const nameRegex = new RegExp(
            `\\b${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'g',
          )
          const allMatches = fullText.match(nameRegex)
          const count = allMatches ? allMatches.length : 0
          if (count <= 1) {
            const varStart = lineContent.indexOf(varName)
            actions.push({
              title: `Prefix unused variable '${varName}' with underscore`,
              kind: 'quickfix',
              edit: makeEdit(
                lineNumber,
                varStart + 1,
                lineNumber,
                varStart + 1 + varName.length,
                `_${varName}`,
              ),
            })
            actions.push({
              title: `Remove unused variable '${varName}'`,
              kind: 'quickfix',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber + 1, 1, ''),
            })
          }
        }

        // ── 5. Missing import for PascalCase symbols ─────────────────
        const pascalCaseMatches = lineContent.match(/\b([A-Z][a-zA-Z0-9]+)\b/g)
        if (pascalCaseMatches) {
          const uniqueSymbols = [...new Set(pascalCaseMatches)]
          const globalSymbols = new Set([
            'React',
            'Array',
            'Object',
            'String',
            'Number',
            'Boolean',
            'Date',
            'Map',
            'Set',
            'Promise',
            'Error',
            'RegExp',
            'JSON',
            'Math',
            'Window',
            'Document',
            'Event',
            'HTMLElement',
            'HTMLDivElement',
            'HTMLInputElement',
            'MouseEvent',
            'KeyboardEvent',
            'Record',
            'Partial',
            'Required',
            'Readonly',
            'Pick',
            'Omit',
            'Exclude',
            'Extract',
            'ReturnType',
            'Parameters',
            'Console',
            'Element',
            'Node',
            'Function',
            'Uint8Array',
            'Int32Array',
            'Float64Array',
            'ArrayBuffer',
            'Symbol',
            'TypeError',
            'RangeError',
            'SyntaxError',
            'ReferenceError',
            'Infinity',
            'NaN',
            'URL',
            'Response',
            'Request',
            'Headers',
          ])
          for (const sym of uniqueSymbols) {
            if (globalSymbols.has(sym)) continue
            const importRegex = new RegExp(
              `import\\s+(?:.*\\b${sym}\\b.*\\s+from|${sym}\\s+from)`,
            )
            if (!importRegex.test(fullText)) {
              const declRegex = new RegExp(
                `(?:function|class|interface|type|enum|const|let|var)\\s+${sym}\\b`,
              )
              if (!declRegex.test(fullText)) {
                actions.push({
                  title: `Add import for '${sym}'`,
                  kind: 'quickfix',
                  isPreferred: true,
                  edit: makeInsert(1, 1, `import { ${sym} } from './${sym}'\n`),
                })
              }
            }
          }
        }

        // ── 6. Convert function declaration to arrow function ────────
        const funcDeclMatch = lineContent.match(
          /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{?\s*$/,
        )
        if (funcDeclMatch) {
          const indent = funcDeclMatch[1]
          const isAsync = lineContent.includes('async ')
          const isExport = lineContent.includes('export ')
          const isDefault = lineContent.includes('default ')
          const funcName = funcDeclMatch[2]
          const params = funcDeclMatch[3]
          const returnTypeMatch = lineContent.match(/\)\s*:\s*([^{]+?)\s*\{?\s*$/)
          const returnType = returnTypeMatch ? `: ${returnTypeMatch[1].trim()}` : ''
          const prefix = (isExport ? 'export ' : '') + (isDefault ? 'default ' : '')
          const arrowFunc = `${indent}${prefix}const ${funcName} = ${isAsync ? 'async ' : ''}(${params})${returnType} => {`
          actions.push({
            title: 'Convert to arrow function',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, arrowFunc),
          })
        }

        // ── 7. Convert arrow function to function declaration ────────
        const arrowFuncMatch = lineContent.match(
          /^(\s*)(export\s+)?(?:default\s+)?(?:const|let)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^=]+?))?\s*=>\s*\{?\s*$/,
        )
        if (arrowFuncMatch) {
          const indent = arrowFuncMatch[1]
          const exportKw = arrowFuncMatch[2] || ''
          const funcName = arrowFuncMatch[3]
          const asyncKw = arrowFuncMatch[4] || ''
          const params = arrowFuncMatch[5]
          const returnType = arrowFuncMatch[6] ? `: ${arrowFuncMatch[6].trim()}` : ''
          const funcDecl = `${indent}${exportKw}${asyncKw}function ${funcName}(${params})${returnType} {`
          actions.push({
            title: 'Convert to function declaration',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, funcDecl),
          })
        }

        // ── 8. Add missing return type annotation ────────────────────
        const arrowNoReturnType = lineContent.match(
          /^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>\s*\{?\s*$/,
        )
        const funcNoReturnType = lineContent.match(
          /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{\s*$/,
        )
        if (arrowNoReturnType || funcNoReturnType) {
          const parenIndex = lineContent.indexOf(')', lineContent.indexOf('('))
          if (parenIndex !== -1) {
            actions.push({
              title: 'Add return type annotation',
              kind: 'refactor.rewrite',
              edit: makeInsert(lineNumber, parenIndex + 2, ': void'),
            })
          }
        }

        // ── 9. Wrap in try/catch (selection required) ────────────────
        if (hasSelection && trimmedSel.length > 0 && selectedText.includes('\n')) {
          const selStartLine = currentSelection!.startLineNumber
          const selEndLine = currentSelection!.endLineNumber
          const baseIndent = getIndent(selStartLine)
          const innerIndent = baseIndent + '  '
          const selectedLines = selectedText
            .split('\n')
            .map((l: string) => innerIndent + l.trimStart())
            .join('\n')
          const wrapped = `${baseIndent}try {\n${selectedLines}\n${baseIndent}} catch (error) {\n${innerIndent}console.error(error)\n${baseIndent}}`
          actions.push({
            title: 'Wrap in try/catch',
            kind: 'refactor.extract',
            edit: makeEdit(
              selStartLine,
              1,
              selEndLine,
              model.getLineContent(selEndLine).length + 1,
              wrapped,
            ),
          })
        }

        // ── 10. Extract to variable (single-line expression) ─────────
        if (
          hasSelection &&
          trimmedSel.length > 0 &&
          !trimmedSel.includes('\n') &&
          !/^\s*(?:const|let|var|function|class|import|export)\s/.test(trimmedSel) &&
          !trimmedSel.endsWith('{')
        ) {
          const indent = getIndent(currentSelection!.startLineNumber)
          const varDecl = `${indent}const extracted = ${trimmedSel}\n`
          actions.push({
            title: 'Extract to variable',
            kind: 'refactor.extract',
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: undefined as undefined,
                  textEdit: {
                    range: new monaco.Range(
                      currentSelection!.startLineNumber,
                      currentSelection!.startColumn,
                      currentSelection!.endLineNumber,
                      currentSelection!.endColumn,
                    ),
                    text: 'extracted',
                  },
                },
                {
                  resource: model.uri,
                  versionId: undefined as undefined,
                  textEdit: {
                    range: new monaco.Range(
                      currentSelection!.startLineNumber,
                      1,
                      currentSelection!.startLineNumber,
                      1,
                    ),
                    text: varDecl,
                  },
                },
              ],
            },
          })
        }

        // ── 11. Generate JSDoc comment ───────────────────────────────
        const jsdocFuncMatch = lineContent.match(
          /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*))\s*(?:=>|\()/,
        )
        if (jsdocFuncMatch) {
          const prevLine =
            lineNumber > 1 ? model.getLineContent(lineNumber - 1).trim() : ''
          if (!prevLine.endsWith('*/') && !prevLine.startsWith('/**')) {
            const indent = jsdocFuncMatch[1]
            const paramListMatch = lineContent.match(/\(([^)]*)\)/)
            const params = paramListMatch
              ? paramListMatch[1]
                  .split(',')
                  .map((p: string) => p.trim().split(/[:\s=]/)[0].trim())
                  .filter(Boolean)
              : []
            const paramLines = params
              .map((p: string) => `${indent} * @param ${p}\n`)
              .join('')
            const jsdoc = `${indent}/**\n${indent} * Description\n${paramLines}${indent} * @returns\n${indent} */\n`
            actions.push({
              title: 'Generate JSDoc comment',
              kind: 'refactor.rewrite',
              edit: makeInsert(lineNumber, 1, jsdoc),
            })
          }
        }

        // ── 12. Convert string concatenation to template literal ─────
        const concatMatch = lineContent.match(
          /^(\s*(?:(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*|return\s+)?)(.+\+.+)(\s*;?\s*)$/,
        )
        if (concatMatch) {
          const rawExpr = concatMatch[2]
          // Only trigger when there is at least one string + variable concat pattern
          if (/(['"`][^'"`]*['"`])\s*\+\s*\w+|\w+\s*\+\s*(['"`][^'"`]*['"`])/.test(rawExpr)) {
            // Parse concatenation parts
            const parts = rawExpr.split(/\s*\+\s*/)
            let templateParts: string[] = []
            for (const part of parts) {
              const trimPart = part.trim()
              const strMatch = trimPart.match(/^(['"])(.*)\1$/)
              if (strMatch) {
                templateParts.push(strMatch[2])
              } else {
                templateParts.push('${' + trimPart + '}')
              }
            }
            const templateStr = '`' + templateParts.join('') + '`'
            const newLine = concatMatch[1] + templateStr + concatMatch[3]
            actions.push({
              title: 'Convert to template literal',
              kind: 'quickfix',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newLine),
            })
          }
        }

        // ── 13. Convert if-else to ternary ───────────────────────────
        // Matches: if (cond) { return/assign X } else { return/assign Y }
        // Also works for multi-line simple if/else blocks
        const ifElseReturnMatch = lineContent.match(
          /^(\s*)if\s*\((.+)\)\s*\{\s*$/,
        )
        if (ifElseReturnMatch && lineNumber + 4 <= totalLines) {
          const indent = ifElseReturnMatch[1]
          const condition = ifElseReturnMatch[2]
          const thenLine = model.getLineContent(lineNumber + 1).trim()
          const closeThen = model.getLineContent(lineNumber + 2).trim()
          const elseLine = model.getLineContent(lineNumber + 3).trim()

          // Pattern: if (cond) { return X } else { return Y }
          const thenReturn = thenLine.match(/^return\s+(.+?)\s*;?$/)
          if (thenReturn && closeThen === '} else {' && lineNumber + 5 <= totalLines) {
            const elseBody = model.getLineContent(lineNumber + 4).trim()
            const elseReturn = elseBody.match(/^return\s+(.+?)\s*;?$/)
            const closeElse = model.getLineContent(lineNumber + 5).trim()
            if (elseReturn && closeElse === '}') {
              const ternary = `${indent}return ${condition} ? ${thenReturn[1]} : ${elseReturn[1]};`
              actions.push({
                title: 'Convert if-else to ternary',
                kind: 'refactor.rewrite',
                edit: makeEdit(lineNumber, 1, lineNumber + 5, model.getLineContent(lineNumber + 5).length + 1, ternary),
              })
            }
          }

          // Pattern: if (cond) { x = A } else { x = B }
          const thenAssign = thenLine.match(/^(\w+)\s*=\s*(.+?)\s*;?$/)
          if (thenAssign && closeThen === '} else {' && lineNumber + 5 <= totalLines) {
            const elseBody = model.getLineContent(lineNumber + 4).trim()
            const elseAssign = elseBody.match(/^(\w+)\s*=\s*(.+?)\s*;?$/)
            const closeElse = model.getLineContent(lineNumber + 5).trim()
            if (elseAssign && elseAssign[1] === thenAssign[1] && closeElse === '}') {
              const ternary = `${indent}${thenAssign[1]} = ${condition} ? ${thenAssign[2]} : ${elseAssign[2]};`
              actions.push({
                title: 'Convert if-else to ternary',
                kind: 'refactor.rewrite',
                edit: makeEdit(lineNumber, 1, lineNumber + 5, model.getLineContent(lineNumber + 5).length + 1, ternary),
              })
            }
          }
        }

        // ── 14. Convert ternary to if-else ───────────────────────────
        const ternaryReturnMatch = lineContent.match(
          /^(\s*)return\s+(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)\s*;?\s*$/,
        )
        if (ternaryReturnMatch) {
          const indent = ternaryReturnMatch[1]
          const cond = ternaryReturnMatch[2]
          const thenVal = ternaryReturnMatch[3]
          const elseVal = ternaryReturnMatch[4].replace(/;$/, '')
          const ifElse = [
            `${indent}if (${cond}) {`,
            `${indent}  return ${thenVal};`,
            `${indent}} else {`,
            `${indent}  return ${elseVal};`,
            `${indent}}`,
          ].join('\n')
          actions.push({
            title: 'Convert ternary to if-else',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, ifElse),
          })
        }
        // Ternary assignment: const x = cond ? a : b
        const ternaryAssignMatch = lineContent.match(
          /^(\s*)(const|let|var)\s+(\w+)\s*=\s*(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)\s*;?\s*$/,
        )
        if (ternaryAssignMatch) {
          const indent = ternaryAssignMatch[1]
          const declKw = ternaryAssignMatch[2]
          const varName = ternaryAssignMatch[3]
          const cond = ternaryAssignMatch[4]
          const thenVal = ternaryAssignMatch[5]
          const elseVal = ternaryAssignMatch[6].replace(/;$/, '')
          const ifElse = [
            `${indent}${declKw} ${varName};`,
            `${indent}if (${cond}) {`,
            `${indent}  ${varName} = ${thenVal};`,
            `${indent}} else {`,
            `${indent}  ${varName} = ${elseVal};`,
            `${indent}}`,
          ].join('\n')
          actions.push({
            title: 'Convert ternary to if-else',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, ifElse),
          })
        }

        // ── 15. Convert to async/await (.then chain) ─────────────────
        const thenChainMatch = lineContent.match(
          /^(\s*)((?:const|let|var)\s+\w+\s*=\s*)?(.+)\.then\(\s*(?:\(?\s*(\w+)\s*\)?\s*=>|function\s*\(\s*(\w+)\s*\))\s*\{?\s*$/,
        )
        if (thenChainMatch) {
          const indent = thenChainMatch[1]
          const assignPart = thenChainMatch[2] || ''
          const promiseExpr = thenChainMatch[3]
          const paramName = thenChainMatch[4] || thenChainMatch[5] || 'result'
          const awaitLine = assignPart
            ? `${indent}${assignPart.replace(/=\s*$/, '').trim()}`
            : `${indent}const ${paramName}`
          const newCode = `${awaitLine} = await ${promiseExpr};`
          actions.push({
            title: 'Convert to async/await',
            kind: 'refactor.rewrite',
            isPreferred: true,
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newCode),
          })
        }
        // Also match single-line .then() pattern: expr.then(x => x.foo)
        const inlineThenMatch = lineContent.match(
          /^(\s*)((?:(?:const|let|var)\s+(\w+)\s*=\s*)|(?:return\s+))(.+)\.then\((\w+)\s*=>\s*(.+)\)\s*;?\s*$/,
        )
        if (inlineThenMatch) {
          const indent = inlineThenMatch[1]
          const prefix = inlineThenMatch[2].trim()
          const promiseExpr = inlineThenMatch[4]
          const paramName = inlineThenMatch[5]
          const body = inlineThenMatch[6].replace(/\)\s*;?\s*$/, '')
          if (prefix.startsWith('return')) {
            const newCode = [
              `${indent}const ${paramName} = await ${promiseExpr};`,
              `${indent}return ${body};`,
            ].join('\n')
            actions.push({
              title: 'Convert to async/await',
              kind: 'refactor.rewrite',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newCode),
            })
          } else {
            const varName = inlineThenMatch[3]
            const newCode = [
              `${indent}const ${paramName} = await ${promiseExpr};`,
              `${indent}const ${varName} = ${body};`,
            ].join('\n')
            actions.push({
              title: 'Convert to async/await',
              kind: 'refactor.rewrite',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newCode),
            })
          }
        }

        // ── 16. Extract interface from object literal ────────────────
        const objectLiteralMatch = lineContent.match(
          /^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*\{\s*$/,
        )
        if (objectLiteralMatch) {
          const indent = objectLiteralMatch[1]
          const varName = objectLiteralMatch[2]
          const interfaceName = varName.charAt(0).toUpperCase() + varName.slice(1)
          // Collect properties until closing brace
          const props: { name: string; value: string }[] = []
          let closingLine = -1
          for (let i = lineNumber + 1; i <= Math.min(lineNumber + 50, totalLines); i++) {
            const pLine = model.getLineContent(i).trim()
            if (pLine === '}' || pLine === '};') {
              closingLine = i
              break
            }
            const propMatch = pLine.match(/^(\w+)\s*:\s*(.+?)\s*,?\s*$/)
            if (propMatch) {
              props.push({ name: propMatch[1], value: propMatch[2] })
            }
          }
          if (closingLine > 0 && props.length > 0) {
            const inferType = (val: string): string => {
              if (/^['"`]/.test(val)) return 'string'
              if (/^-?\d+(\.\d+)?$/.test(val)) return 'number'
              if (val === 'true' || val === 'false') return 'boolean'
              if (val.startsWith('[')) return 'unknown[]'
              if (val.startsWith('{')) return 'Record<string, unknown>'
              if (/^\(/.test(val) || /=>/.test(val) || val.startsWith('function')) return '() => void'
              if (val === 'null') return 'null'
              if (val === 'undefined') return 'undefined'
              return 'unknown'
            }
            const interfaceProps = props
              .map((p) => `${indent}  ${p.name}: ${inferType(p.value)};`)
              .join('\n')
            const interfaceDecl = `${indent}interface ${interfaceName} {\n${interfaceProps}\n${indent}}\n\n`
            actions.push({
              title: `Extract interface '${interfaceName}'`,
              kind: 'refactor.extract',
              edit: makeMultiEdit(
                { startLine: lineNumber, startCol: 1, endLine: lineNumber, endCol: 1, text: interfaceDecl },
                // Add type annotation to the variable
                {
                  startLine: lineNumber,
                  startCol: lineContent.indexOf('='),
                  endLine: lineNumber,
                  endCol: lineContent.indexOf('='),
                  text: `: ${interfaceName} `,
                },
              ),
            })
          }
        }

        // ── 17. Convert named export to default export ───────────────
        const namedExportMatch = lineContent.match(
          /^(\s*)export\s+((?:const|let|var|function|class)\s+(\w+))/,
        )
        if (namedExportMatch && !lineContent.includes('export default')) {
          const indent = namedExportMatch[1]
          const rest = namedExportMatch[2]
          const name = namedExportMatch[3]
          const newLine = lineContent.replace(/^(\s*)export\s+/, `$1export default `)
          actions.push({
            title: `Convert to default export`,
            kind: 'quickfix',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newLine),
          })
        }

        // ── 18. Add null check ───────────────────────────────────────
        // Detect property access on a variable: foo.bar or foo[bar]
        const propAccessMatch = lineContent.match(
          /^(\s*)(.*\b(\w+)(?:\.\w+|\[.+\]).*)\s*$/,
        )
        if (propAccessMatch) {
          const indent = propAccessMatch[1]
          const stmt = propAccessMatch[2]
          const varName = propAccessMatch[3]
          // Only offer if the variable name is not a keyword
          const keywords = new Set(['if', 'else', 'for', 'while', 'return', 'const', 'let', 'var', 'function', 'class', 'new', 'this', 'typeof', 'import', 'export', 'switch', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'default', 'void', 'delete', 'in', 'of', 'instanceof', 'console', 'Math', 'JSON', 'Object', 'Array', 'window', 'document', 'process'])
          if (
            !keywords.has(varName) &&
            /\b\w+\.\w+/.test(lineContent) &&
            !lineContent.trim().startsWith('//') &&
            !lineContent.trim().startsWith('*') &&
            !lineContent.includes(`${varName} != null`) &&
            !lineContent.includes(`${varName} !== null`)
          ) {
            const nullCheckLine = `${indent}if (${varName} == null) return;\n`
            actions.push({
              title: `Add null check for '${varName}'`,
              kind: 'quickfix',
              edit: makeInsert(lineNumber, 1, nullCheckLine),
            })
            // Also offer optional chaining variant
            const optionalChained = lineContent.replace(
              new RegExp(`\\b${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`, 'g'),
              `${varName}?.`,
            )
            if (optionalChained !== lineContent) {
              actions.push({
                title: `Use optional chaining for '${varName}'`,
                kind: 'quickfix',
                isPreferred: true,
                edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, optionalChained),
              })
            }
          }
        }

        // ── 19. Convert forEach to for-of ────────────────────────────
        const forEachMatch = lineContent.match(
          /^(\s*)(\w+(?:\.\w+)*)\.forEach\(\s*(?:\(?\s*(\w+)(?:\s*,\s*(\w+))?\s*\)?\s*=>|function\s*\(\s*(\w+)(?:\s*,\s*(\w+))?\s*\))\s*\{?\s*$/,
        )
        if (forEachMatch) {
          const indent = forEachMatch[1]
          const arrayExpr = forEachMatch[2]
          const itemParam = forEachMatch[3] || forEachMatch[5] || 'item'
          const indexParam = forEachMatch[4] || forEachMatch[6]
          // Find the closing of the forEach
          let braceDepth = lineContent.includes('{') ? 1 : 0
          let closeLine = -1
          for (let i = lineNumber + 1; i <= Math.min(lineNumber + 100, totalLines); i++) {
            const l = model.getLineContent(i)
            for (const ch of l) {
              if (ch === '{') braceDepth++
              else if (ch === '}') braceDepth--
            }
            if (braceDepth <= 0) {
              closeLine = i
              break
            }
          }
          if (closeLine > 0) {
            // Collect body lines
            const bodyLines: string[] = []
            for (let i = lineNumber + 1; i < closeLine; i++) {
              bodyLines.push(model.getLineContent(i))
            }
            const body = bodyLines.join('\n')
            let forOfHeader: string
            if (indexParam) {
              forOfHeader = `${indent}for (const [${indexParam}, ${itemParam}] of ${arrayExpr}.entries()) {`
            } else {
              forOfHeader = `${indent}for (const ${itemParam} of ${arrayExpr}) {`
            }
            const forOfBlock = `${forOfHeader}\n${body}\n${indent}}`
            actions.push({
              title: 'Convert forEach to for-of',
              kind: 'refactor.rewrite',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, closeLine, model.getLineContent(closeLine).length + 1, forOfBlock),
            })
          }
        }
        // Also match single-line forEach: arr.forEach(item => expr);
        const inlineForEachMatch = lineContent.match(
          /^(\s*)(\w+(?:\.\w+)*)\.forEach\(\(?(\w+)\)?\s*=>\s*(.+?)\s*\)\s*;?\s*$/,
        )
        if (inlineForEachMatch) {
          const indent = inlineForEachMatch[1]
          const arrayExpr = inlineForEachMatch[2]
          const item = inlineForEachMatch[3]
          const body = inlineForEachMatch[4]
          const forOf = [
            `${indent}for (const ${item} of ${arrayExpr}) {`,
            `${indent}  ${body};`,
            `${indent}}`,
          ].join('\n')
          actions.push({
            title: 'Convert forEach to for-of',
            kind: 'refactor.rewrite',
            isPreferred: true,
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, forOf),
          })
        }

        // ── 20. Simplify conditional expression ──────────────────────
        // Pattern: if (x) return true; else return false; => return x;
        // Pattern: x === true => x, x === false => !x
        // Pattern: !!expr => Boolean(expr)
        const simplifyTrueMatch = lineContent.match(/^(\s*)if\s*\((.+)\)\s*\{\s*return\s+true\s*;?\s*\}\s*$/)
        if (simplifyTrueMatch && lineNumber + 1 <= totalLines) {
          const nextLine = model.getLineContent(lineNumber + 1).trim()
          if (/^}\s*else\s*\{\s*return\s+false\s*;?\s*\}\s*$/.test(nextLine) || /^else\s*\{\s*return\s+false\s*;?\s*\}\s*$/.test(nextLine)) {
            const indent = simplifyTrueMatch[1]
            const cond = simplifyTrueMatch[2]
            actions.push({
              title: 'Simplify to return condition directly',
              kind: 'quickfix',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber + 1, model.getLineContent(lineNumber + 1).length + 1, `${indent}return ${cond};`),
            })
          }
        }
        // x === true => x
        if (lineContent.includes('=== true')) {
          const simplified = lineContent.replace(/(\w+)\s*===\s*true/g, '$1')
          if (simplified !== lineContent) {
            actions.push({
              title: 'Simplify comparison with true',
              kind: 'quickfix',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, simplified),
            })
          }
        }
        // x === false => !x
        if (lineContent.includes('=== false')) {
          const simplified = lineContent.replace(/(\w+)\s*===\s*false/g, '!$1')
          if (simplified !== lineContent) {
            actions.push({
              title: 'Simplify comparison with false',
              kind: 'quickfix',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, simplified),
            })
          }
        }
        // x !== true => !x, x !== false => x
        if (lineContent.includes('!== true')) {
          const simplified = lineContent.replace(/(\w+)\s*!==\s*true/g, '!$1')
          if (simplified !== lineContent) {
            actions.push({
              title: 'Simplify comparison with true',
              kind: 'quickfix',
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, simplified),
            })
          }
        }
        if (lineContent.includes('!== false')) {
          const simplified = lineContent.replace(/(\w+)\s*!==\s*false/g, '$1')
          if (simplified !== lineContent) {
            actions.push({
              title: 'Simplify comparison with false',
              kind: 'quickfix',
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, simplified),
            })
          }
        }

        // ── 21. Convert require to import ────────────────────────────
        const requireMatch = lineContent.match(
          /^(\s*)(?:const|let|var)\s+(\{[^}]+\}|\w+)\s*=\s*require\(\s*(['"`][^'"`]+['"`])\s*\)\s*;?\s*$/,
        )
        if (requireMatch) {
          const indent = requireMatch[1]
          const binding = requireMatch[2].trim()
          const modulePath = requireMatch[3]
          let importStmt: string
          if (binding.startsWith('{')) {
            importStmt = `${indent}import ${binding} from ${modulePath};`
          } else {
            importStmt = `${indent}import ${binding} from ${modulePath};`
          }
          actions.push({
            title: 'Convert require to import',
            kind: 'quickfix',
            isPreferred: true,
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, importStmt),
          })
        }

        // ── 22. Convert callback to promise ──────────────────────────
        // Detects: someFunc(args, (err, result) => { ... })
        const callbackMatch = lineContent.match(
          /^(\s*)(\w+)\((.+),\s*\(\s*(err(?:or)?)\s*,\s*(\w+)\s*\)\s*=>\s*\{\s*$/,
        )
        if (callbackMatch) {
          const indent = callbackMatch[1]
          const funcCall = callbackMatch[2]
          const args = callbackMatch[3]
          const resultName = callbackMatch[5]
          const promisified = `${indent}const ${resultName} = await ${funcCall}(${args});`
          actions.push({
            title: 'Convert callback to async/await',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, promisified),
          })
        }

        // ── 23. Convert == to === (and != to !==) ────────────────────
        if (/[^!=]==[^=]/.test(lineContent) && !/===/.test(lineContent)) {
          const fixed = lineContent.replace(/([^!=])==([^=])/g, '$1===$2')
          actions.push({
            title: 'Convert == to ===',
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: [{
              message: 'Use strict equality (===) instead of abstract equality (==)',
              severity: 4,
            }],
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, fixed),
          })
        }
        if (/[^!]!=[^=]/.test(lineContent) && !/!==/.test(lineContent)) {
          const fixed = lineContent.replace(/([^!])!=([^=])/g, '$1!==$2')
          actions.push({
            title: 'Convert != to !==',
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: [{
              message: 'Use strict inequality (!==) instead of abstract inequality (!=)',
              severity: 4,
            }],
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, fixed),
          })
        }

        // ── 24. Add type assertion ───────────────────────────────────
        if (hasSelection && trimmedSel.length > 0 && !trimmedSel.includes('\n')) {
          actions.push({
            title: 'Add type assertion (as unknown)',
            kind: 'quickfix',
            edit: makeEdit(
              currentSelection!.startLineNumber,
              currentSelection!.startColumn,
              currentSelection!.endLineNumber,
              currentSelection!.endColumn,
              `(${trimmedSel} as unknown)`,
            ),
          })
        }

        // ── 25. Convert named function expression to arrow ───────────
        // const x = function(params) { -> const x = (params) => {
        const namedFuncExprMatch = lineContent.match(
          /^(\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*)(async\s+)?function\s*\w*\s*(\([^)]*\))\s*(\{)\s*$/,
        )
        if (namedFuncExprMatch) {
          const prefix = namedFuncExprMatch[1]
          const asyncKw = namedFuncExprMatch[2] || ''
          const params = namedFuncExprMatch[3]
          const newLine = `${prefix}${asyncKw}${params} => {`
          actions.push({
            title: 'Convert function expression to arrow',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newLine),
          })
        }

        // ── 26. Wrap in Promise ──────────────────────────────────────
        if (hasSelection && trimmedSel.length > 0) {
          const selIndent = getIndent(currentSelection!.startLineNumber)
          const innerInd = selIndent + '  '
          const wrappedLines = selectedText.split('\n').map((l: string) => innerInd + '  ' + l.trimStart()).join('\n')
          const wrapped = [
            `${selIndent}return new Promise((resolve, reject) => {`,
            wrappedLines,
            `${selIndent}});`,
          ].join('\n')
          actions.push({
            title: 'Wrap in Promise',
            kind: 'refactor.extract',
            edit: makeEdit(
              currentSelection!.startLineNumber,
              1,
              currentSelection!.endLineNumber,
              model.getLineContent(currentSelection!.endLineNumber).length + 1,
              wrapped,
            ),
          })
        }

        // ── 27. Sort imports alphabetically (source action) ──────────
        // Detect if cursor is inside import region
        if (/^\s*import\s/.test(lineContent)) {
          // Find all import lines at top of file
          let importStart = -1
          let importEnd = -1
          for (let i = 1; i <= totalLines; i++) {
            const l = model.getLineContent(i).trim()
            if (l.startsWith('import ')) {
              if (importStart === -1) importStart = i
              importEnd = i
            } else if (importStart !== -1 && l !== '' && !l.startsWith('//')) {
              break
            }
          }
          if (importStart >= 1 && importEnd >= importStart) {
            const importLines: string[] = []
            for (let i = importStart; i <= importEnd; i++) {
              const l = model.getLineContent(i)
              if (l.trim().startsWith('import ')) {
                importLines.push(l)
              }
            }
            const sorted = [...importLines].sort((a, b) => {
              // Sort by module path
              const pathA = a.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || a
              const pathB = b.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || b
              return pathA.localeCompare(pathB)
            })
            const isAlreadySorted = importLines.every((line, i) => line === sorted[i])
            if (!isAlreadySorted) {
              actions.push({
                title: 'Sort imports alphabetically',
                kind: 'source.organizeImports',
                isPreferred: true,
                edit: makeEdit(
                  importStart,
                  1,
                  importEnd,
                  model.getLineContent(importEnd).length + 1,
                  sorted.join('\n'),
                ),
              })
            }
          }
        }

        // ── 28. Extract function (selection, multi-line) ─────────────
        if (hasSelection && trimmedSel.length > 0 && selectedText.includes('\n')) {
          const selStart = currentSelection!.startLineNumber
          const selEnd = currentSelection!.endLineNumber
          const baseIndent = getIndent(selStart)

          // Detect variables used in selected text that may be params
          const usedVars = new Set<string>()
          const declaredVars = new Set<string>()
          const selLines = selectedText.split('\n')
          for (const sl of selLines) {
            const declMatch = sl.match(/(?:const|let|var)\s+(\w+)/)
            if (declMatch) declaredVars.add(declMatch[1])
            const varRefs = sl.match(/\b[a-z_$]\w*\b/g)
            if (varRefs) {
              for (const v of varRefs) usedVars.add(v)
            }
          }
          // Remove declared vars from used vars to find params
          const keywords = new Set(['const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'function', 'class', 'new', 'typeof', 'void', 'delete', 'true', 'false', 'null', 'undefined', 'this', 'await', 'async', 'throw', 'try', 'catch', 'finally', 'switch', 'case', 'break', 'continue', 'do', 'in', 'of', 'instanceof', 'import', 'export', 'default', 'from', 'as', 'type', 'interface', 'enum'])
          const params: string[] = []
          for (const v of usedVars) {
            if (!declaredVars.has(v) && !keywords.has(v) && v.length > 1) {
              params.push(v)
            }
          }
          const paramStr = params.slice(0, 5).join(', ')

          const indentedBody = selLines
            .map((l: string) => '  ' + l.trimStart())
            .join('\n')

          const extractedFunc = `function extracted(${paramStr}) {\n${indentedBody}\n}\n\n`
          const callSite = `${baseIndent}extracted(${paramStr});`

          actions.push({
            title: 'Extract function',
            kind: 'refactor.extract',
            edit: makeMultiEdit(
              {
                startLine: selStart,
                startCol: 1,
                endLine: selEnd,
                endCol: model.getLineContent(selEnd).length + 1,
                text: callSite,
              },
              // Insert function above the current function (find function start)
              {
                startLine: 1,
                startCol: 1,
                endLine: 1,
                endCol: 1,
                text: extractedFunc,
              },
            ),
          })
        }

        // ── 29. Inline variable ──────────────────────────────────────
        const inlineVarMatch = lineContent.match(
          /^(\s*)(?:const|let|var)\s+(\w+)\s*=\s*(.+?)\s*;?\s*$/,
        )
        if (inlineVarMatch) {
          const varName = inlineVarMatch[2]
          const value = inlineVarMatch[3]
          // Check if variable is used in subsequent lines
          const nameRegex = new RegExp(
            `\\b${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'g',
          )
          const afterDecl = fullText.substring(
            model.getOffsetAt({ lineNumber: lineNumber + 1, column: 1 }),
          )
          const usages = afterDecl.match(nameRegex)
          if (usages && usages.length >= 1 && usages.length <= 5) {
            // Build edits: remove the declaration line and replace each usage with value
            const edits: { startLine: number; startCol: number; endLine: number; endCol: number; text: string }[] = [
              { startLine: lineNumber, startCol: 1, endLine: lineNumber + 1, endCol: 1, text: '' },
            ]
            // Replace usages in subsequent lines
            for (let i = lineNumber + 1; i <= totalLines; i++) {
              const lContent = model.getLineContent(i)
              if (nameRegex.test(lContent)) {
                nameRegex.lastIndex = 0
                const replaced = lContent.replace(nameRegex, value)
                edits.push({
                  startLine: i,
                  startCol: 1,
                  endLine: i,
                  endCol: lContent.length + 1,
                  text: replaced,
                })
              }
            }
            actions.push({
              title: `Inline variable '${varName}'`,
              kind: 'refactor.inline',
              edit: makeMultiEdit(...edits),
            })
          }
        }

        // ── 30. Rename symbol (trigger Monaco rename) ────────────────
        const wordAtCursor = model.getWordAtPosition({
          lineNumber: range.startLineNumber,
          column: range.startColumn,
        })
        if (wordAtCursor) {
          actions.push({
            title: `Rename '${wordAtCursor.word}'`,
            kind: 'refactor',
            command: {
              id: 'editor.action.rename',
              title: 'Rename Symbol',
            },
          })
        }

        // ── 31. Organize imports (source action) ─────────────────────
        // Find and clean up imports: remove duplicates, sort, group
        {
          let importStart = -1
          let importEnd = -1
          const importLines: string[] = []
          for (let i = 1; i <= totalLines; i++) {
            const l = model.getLineContent(i).trim()
            if (l.startsWith('import ')) {
              if (importStart === -1) importStart = i
              importEnd = i
              importLines.push(model.getLineContent(i))
            } else if (importStart !== -1 && l !== '' && !l.startsWith('//')) {
              break
            }
          }
          if (importStart >= 1 && importLines.length > 1) {
            // Remove exact duplicates
            const uniqueImports = [...new Set(importLines)]
            // Sort: packages first (no . prefix), then local (with . prefix)
            const packageImports = uniqueImports
              .filter((l) => {
                const mod = l.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || ''
                return !mod.startsWith('.')
              })
              .sort((a, b) => {
                const pathA = a.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || a
                const pathB = b.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || b
                return pathA.localeCompare(pathB)
              })
            const localImports = uniqueImports
              .filter((l) => {
                const mod = l.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || ''
                return mod.startsWith('.')
              })
              .sort((a, b) => {
                const pathA = a.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || a
                const pathB = b.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1] || b
                return pathA.localeCompare(pathB)
              })
            const organized = packageImports.length > 0 && localImports.length > 0
              ? [...packageImports, '', ...localImports].join('\n')
              : [...packageImports, ...localImports].join('\n')

            const current = importLines.join('\n')
            if (organized !== current) {
              actions.push({
                title: 'Organize imports',
                kind: 'source.organizeImports',
                isPreferred: true,
                edit: makeEdit(
                  importStart,
                  1,
                  importEnd,
                  model.getLineContent(importEnd).length + 1,
                  organized,
                ),
              })
            }
          }
        }

        // ── 32. Generate getters/setters ─────────────────────────────
        // Detect class property: private/public/protected name: type;
        const classPropMatch = lineContent.match(
          /^(\s*)(?:private|protected|public|readonly)?\s*(\w+)\s*(?::\s*([^=;]+))?\s*(?:=\s*[^;]+)?\s*;?\s*$/,
        )
        // Verify we are inside a class body by checking preceding lines for `class`
        if (classPropMatch && classPropMatch[2] && !/^\s*(?:const|let|var|function|import|export|return|if|for|while)\b/.test(lineContent)) {
          let insideClass = false
          for (let i = lineNumber - 1; i >= Math.max(1, lineNumber - 30); i--) {
            if (/\bclass\s+\w+/.test(model.getLineContent(i))) {
              insideClass = true
              break
            }
          }
          if (insideClass) {
            const indent = classPropMatch[1]
            const propName = classPropMatch[2]
            const propType = classPropMatch[3]?.trim() || 'unknown'
            const capName = propName.charAt(0).toUpperCase() + propName.slice(1)
            const privateName = propName.startsWith('_') ? propName : `_${propName}`
            const publicName = propName.startsWith('_') ? propName.slice(1) : propName
            const capPublic = publicName.charAt(0).toUpperCase() + publicName.slice(1)

            const getter = [
              ``,
              `${indent}get ${publicName}(): ${propType} {`,
              `${indent}  return this.${privateName};`,
              `${indent}}`,
            ].join('\n')

            const setter = [
              ``,
              `${indent}set ${publicName}(value: ${propType}) {`,
              `${indent}  this.${privateName} = value;`,
              `${indent}}`,
            ].join('\n')

            // Find end of property line to insert after
            actions.push({
              title: `Generate getter and setter for '${publicName}'`,
              kind: 'source',
              edit: makeInsert(lineNumber + 1, 1, getter + '\n' + setter + '\n'),
            })
            actions.push({
              title: `Generate getter for '${publicName}'`,
              kind: 'source',
              edit: makeInsert(lineNumber + 1, 1, getter + '\n'),
            })
            actions.push({
              title: `Generate setter for '${publicName}'`,
              kind: 'source',
              edit: makeInsert(lineNumber + 1, 1, setter + '\n'),
            })
          }
        }

        // ── 33. Implement interface methods ──────────────────────────
        // Detect: class X implements Y {
        const implementsMatch = lineContent.match(
          /^(\s*)(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?\s+implements\s+(\w+(?:\s*,\s*\w+)*)\s*\{\s*$/,
        )
        if (implementsMatch) {
          const indent = implementsMatch[1]
          const interfaces = implementsMatch[3].split(',').map((s: string) => s.trim())
          const innerIndent = indent + '  '

          // Find the closing brace of the class
          let closingBrace = -1
          let depth = 1
          for (let i = lineNumber + 1; i <= totalLines; i++) {
            const l = model.getLineContent(i)
            for (const ch of l) {
              if (ch === '{') depth++
              else if (ch === '}') depth--
            }
            if (depth <= 0) {
              closingBrace = i
              break
            }
          }

          if (closingBrace > 0) {
            // Look for interface definitions in the file
            for (const ifaceName of interfaces) {
              const ifaceRegex = new RegExp(`interface\\s+${ifaceName}\\s*\\{`)
              const ifaceMatch = fullText.match(ifaceRegex)
              if (ifaceMatch) {
                // Find interface body
                const ifaceStart = fullText.indexOf(ifaceMatch[0])
                let ifaceBody = ''
                let braceCount = 0
                let collecting = false
                for (let ci = ifaceStart; ci < fullText.length; ci++) {
                  if (fullText[ci] === '{') {
                    braceCount++
                    collecting = true
                  } else if (fullText[ci] === '}') {
                    braceCount--
                    if (braceCount === 0) {
                      ifaceBody = fullText.substring(ifaceStart + ifaceMatch[0].length, ci)
                      break
                    }
                  }
                }

                if (ifaceBody) {
                  // Parse interface members
                  const memberLines = ifaceBody.split('\n').map((l: string) => l.trim()).filter(Boolean)
                  const stubs: string[] = []
                  for (const ml of memberLines) {
                    const methodMatch = ml.match(/^(\w+)\s*(\([^)]*\))\s*:\s*(.+?)\s*;?\s*$/)
                    if (methodMatch) {
                      stubs.push(
                        `${innerIndent}${methodMatch[1]}${methodMatch[2]}: ${methodMatch[3]} {`,
                        `${innerIndent}  throw new Error('Not implemented');`,
                        `${innerIndent}}`,
                        ``,
                      )
                    }
                    const propMatch = ml.match(/^(\w+)\s*(?:\?\s*)?:\s*(.+?)\s*;?\s*$/)
                    if (propMatch && !methodMatch) {
                      stubs.push(`${innerIndent}${propMatch[1]}: ${propMatch[2]};`, ``)
                    }
                  }

                  if (stubs.length > 0) {
                    actions.push({
                      title: `Implement interface '${ifaceName}'`,
                      kind: 'source',
                      isPreferred: true,
                      edit: makeInsert(lineNumber + 1, 1, stubs.join('\n') + '\n'),
                    })
                  }
                }
              } else {
                // Interface not found in file - generate stubs with comment
                actions.push({
                  title: `Implement interface '${ifaceName}' (stubs)`,
                  kind: 'source',
                  edit: makeInsert(
                    lineNumber + 1,
                    1,
                    `${innerIndent}// TODO: Implement ${ifaceName} members\n`,
                  ),
                })
              }
            }
          }
        }

        // ── 34. Convert to destructured assignment ───────────────────
        // Detect: const x = obj.prop; => const { prop } = obj;  (multiple on same obj)
        const dotAccessAssign = lineContent.match(
          /^(\s*)(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\.(\w+)\s*;?\s*$/,
        )
        if (dotAccessAssign) {
          const indent = dotAccessAssign[1]
          const localName = dotAccessAssign[2]
          const objName = dotAccessAssign[3]
          const propName = dotAccessAssign[4]
          if (localName === propName) {
            const destructured = `${indent}const { ${propName} } = ${objName};`
            actions.push({
              title: 'Convert to destructured assignment',
              kind: 'refactor.rewrite',
              isPreferred: true,
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, destructured),
            })
          } else {
            const destructured = `${indent}const { ${propName}: ${localName} } = ${objName};`
            actions.push({
              title: 'Convert to destructured assignment',
              kind: 'refactor.rewrite',
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, destructured),
            })
          }
        }

        // ── 35. Convert string to template literal ───────────────────
        // Simple case: 'string' or "string" to `string`
        if (hasSelection && trimmedSel.length > 0) {
          const strLitMatch = trimmedSel.match(/^(['"])(.*)(\1)$/)
          if (strLitMatch) {
            const content = strLitMatch[2]
            actions.push({
              title: 'Convert to template literal',
              kind: 'refactor.rewrite',
              edit: makeEdit(
                currentSelection!.startLineNumber,
                currentSelection!.startColumn,
                currentSelection!.endLineNumber,
                currentSelection!.endColumn,
                '`' + content + '`',
              ),
            })
          }
        }

        // ── 36. Toggle optional parameter ────────────────────────────
        // foo: string => foo?: string and vice versa
        const optParamMatch = lineContent.match(/^(\s*)(\w+)(\??):\s*(.+?)\s*[,;)]\s*$/)
        if (optParamMatch) {
          const indent = optParamMatch[1]
          const paramName = optParamMatch[2]
          const isOptional = optParamMatch[3] === '?'
          const typePart = optParamMatch[4]
          const suffix = lineContent.match(/([,;)])\s*$/)?.[1] || ''
          if (isOptional) {
            const newLine = `${indent}${paramName}: ${typePart}${suffix}`
            actions.push({
              title: `Make '${paramName}' required`,
              kind: 'refactor.rewrite',
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newLine),
            })
          } else {
            const newLine = `${indent}${paramName}?: ${typePart}${suffix}`
            actions.push({
              title: `Make '${paramName}' optional`,
              kind: 'refactor.rewrite',
              edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newLine),
            })
          }
        }

        // ── 37. Add error handling (add try-catch to function body) ──
        const funcBodyMatch = lineContent.match(
          /^(\s*)(?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)\s*\{\s*$/,
        )
        if (funcBodyMatch) {
          const indent = funcBodyMatch[1]
          const innerIndent = indent + '  '
          const innerInnerIndent = innerIndent + '  '
          // Find closing brace of the function
          let braceCount = 1
          let closeLine = -1
          for (let i = lineNumber + 1; i <= Math.min(lineNumber + 200, totalLines); i++) {
            const l = model.getLineContent(i)
            for (const ch of l) {
              if (ch === '{') braceCount++
              else if (ch === '}') braceCount--
            }
            if (braceCount === 0) {
              closeLine = i
              break
            }
          }
          if (closeLine > lineNumber + 1) {
            const bodyLines: string[] = []
            for (let i = lineNumber + 1; i < closeLine; i++) {
              const original = model.getLineContent(i)
              bodyLines.push(innerInnerIndent + original.trimStart())
            }
            const wrappedBody = [
              `${innerIndent}try {`,
              ...bodyLines,
              `${innerIndent}} catch (error) {`,
              `${innerInnerIndent}console.error(error);`,
              `${innerInnerIndent}throw error;`,
              `${innerIndent}}`,
            ].join('\n')
            actions.push({
              title: 'Add error handling to function',
              kind: 'refactor.rewrite',
              edit: makeEdit(
                lineNumber + 1,
                1,
                closeLine - 1,
                model.getLineContent(closeLine - 1).length + 1,
                wrappedBody,
              ),
            })
          }
        }

        // ── 38. Surround with if-check ───────────────────────────────
        if (hasSelection && trimmedSel.length > 0) {
          const selStart = currentSelection!.startLineNumber
          const selEnd = currentSelection!.endLineNumber
          const baseIndent = getIndent(selStart)
          const innerIndent = baseIndent + '  '
          const wrappedLines = selectedText
            .split('\n')
            .map((l: string) => innerIndent + l.trimStart())
            .join('\n')
          actions.push({
            title: 'Surround with if',
            kind: 'refactor.extract',
            edit: makeEdit(
              selStart,
              1,
              selEnd,
              model.getLineContent(selEnd).length + 1,
              `${baseIndent}if (condition) {\n${wrappedLines}\n${baseIndent}}`,
            ),
          })
        }

        // ── 39. Convert to readonly ──────────────────────────────────
        if (/^\s*(private|protected|public)\s+(?!readonly\b)\w+/.test(lineContent)) {
          const newLine = lineContent.replace(
            /^(\s*)(private|protected|public)\s+/,
            '$1$2 readonly ',
          )
          actions.push({
            title: 'Make property readonly',
            kind: 'refactor.rewrite',
            edit: makeEdit(lineNumber, 1, lineNumber, lineContent.length + 1, newLine),
          })
        }

        // ── 40. Convert type to interface (and vice versa) ───────────
        const typeAliasMatch = lineContent.match(
          /^(\s*)(?:export\s+)?type\s+(\w+)\s*=\s*\{\s*$/,
        )
        if (typeAliasMatch) {
          const indent = typeAliasMatch[1]
          const typeName = typeAliasMatch[2]
          const isExport = lineContent.includes('export ')
          const newLine = `${indent}${isExport ? 'export ' : ''}interface ${typeName} {`
          // Find closing }; or }
          let closeLine = -1
          let depth = 1
          for (let i = lineNumber + 1; i <= Math.min(lineNumber + 100, totalLines); i++) {
            const l = model.getLineContent(i)
            for (const ch of l) {
              if (ch === '{') depth++
              else if (ch === '}') depth--
            }
            if (depth <= 0) {
              closeLine = i
              break
            }
          }
          if (closeLine > 0) {
            const closeContent = model.getLineContent(closeLine)
            const newClose = closeContent.replace(/\}\s*;?\s*$/, '}')
            actions.push({
              title: `Convert type '${typeName}' to interface`,
              kind: 'refactor.rewrite',
              edit: makeMultiEdit(
                { startLine: lineNumber, startCol: 1, endLine: lineNumber, endCol: lineContent.length + 1, text: newLine },
                { startLine: closeLine, startCol: 1, endLine: closeLine, endCol: closeContent.length + 1, text: newClose },
              ),
            })
          }
        }
        const interfaceMatch = lineContent.match(
          /^(\s*)(?:export\s+)?interface\s+(\w+)\s*\{\s*$/,
        )
        if (interfaceMatch) {
          const indent = interfaceMatch[1]
          const intName = interfaceMatch[2]
          const isExport = lineContent.includes('export ')
          const newLine = `${indent}${isExport ? 'export ' : ''}type ${intName} = {`
          let closeLine = -1
          let depth = 1
          for (let i = lineNumber + 1; i <= Math.min(lineNumber + 100, totalLines); i++) {
            const l = model.getLineContent(i)
            for (const ch of l) {
              if (ch === '{') depth++
              else if (ch === '}') depth--
            }
            if (depth <= 0) {
              closeLine = i
              break
            }
          }
          if (closeLine > 0) {
            const closeContent = model.getLineContent(closeLine)
            const newClose = closeContent.replace(/\}\s*$/, '};')
            actions.push({
              title: `Convert interface '${intName}' to type`,
              kind: 'refactor.rewrite',
              edit: makeMultiEdit(
                { startLine: lineNumber, startCol: 1, endLine: lineNumber, endCol: lineContent.length + 1, text: newLine },
                { startLine: closeLine, startCol: 1, endLine: closeLine, endCol: closeContent.length + 1, text: newClose },
              ),
            })
          }
        }

        return {
          actions,
          dispose: () => {},
        }
      },
    })
  }
}
