/**
 * Built-in TODO Highlighter Extension.
 * Highlights TODO, FIXME, HACK, BUG, XXX comments with distinct colors.
 */

import type { ExtensionInstance, ExtensionContext } from '../api'

const TODO_PATTERNS = [
  { tag: 'TODO', color: '#FFB86C', bgColor: 'rgba(255,184,108,0.15)' },
  { tag: 'FIXME', color: '#FF5555', bgColor: 'rgba(255,85,85,0.15)' },
  { tag: 'HACK', color: '#FF79C6', bgColor: 'rgba(255,121,198,0.15)' },
  { tag: 'BUG', color: '#FF5555', bgColor: 'rgba(255,85,85,0.2)' },
  { tag: 'XXX', color: '#BD93F9', bgColor: 'rgba(189,147,249,0.15)' },
  { tag: 'NOTE', color: '#8BE9FD', bgColor: 'rgba(139,233,253,0.1)' },
  { tag: 'REVIEW', color: '#50FA7B', bgColor: 'rgba(80,250,123,0.1)' },
  { tag: 'PERF', color: '#F1FA8C', bgColor: 'rgba(241,250,140,0.1)' },
]

export const todoHighlighter: ExtensionInstance = {
  id: 'orion.todo-highlighter',
  manifest: {
    name: 'todo-highlighter',
    displayName: 'TODO Highlighter',
    version: '1.0.0',
    description: 'Highlight TODO, FIXME, HACK, BUG comments in your code',
    publisher: 'orion',
    categories: ['Other'],
    activationEvents: ['*'],
    contributes: {
      commands: [
        { command: 'todoHighlighter.listTodos', title: 'List All TODOs' },
      ],
      configuration: {
        title: 'TODO Highlighter',
        properties: {
          'todoHighlighter.enabled': {
            type: 'boolean',
            default: true,
            description: 'Enable/disable TODO highlighting',
          },
          'todoHighlighter.keywords': {
            type: 'string',
            default: 'TODO,FIXME,HACK,BUG,XXX,NOTE',
            description: 'Comma-separated list of keywords to highlight',
          },
        },
      },
    },
  },
  isActive: false,

  activate(context: ExtensionContext) {
    // Register decoration styles via CSS
    const styleEl = document.createElement('style')
    styleEl.id = 'orion-ext-todo-highlighter'

    let css = ''
    for (const { tag, color, bgColor } of TODO_PATTERNS) {
      css += `
        .todo-highlight-${tag.toLowerCase()} {
          color: ${color} !important;
          background-color: ${bgColor};
          border-radius: 2px;
          padding: 0 2px;
          font-weight: 600;
        }
      `
    }
    styleEl.textContent = css
    document.head.appendChild(styleEl)

    context.subscriptions.push({
      dispose: () => styleEl.remove(),
    })

    // Dispatch event so editor can pick up the decorations
    window.dispatchEvent(new CustomEvent('orion:extension-activated', {
      detail: {
        id: 'orion.todo-highlighter',
        decorations: TODO_PATTERNS.map(p => ({
          pattern: new RegExp(`\\b${p.tag}\\b`, 'g'),
          className: `todo-highlight-${p.tag.toLowerCase()}`,
        })),
      },
    }))
  },

  deactivate() {
    const el = document.getElementById('orion-ext-todo-highlighter')
    el?.remove()
  },
}
