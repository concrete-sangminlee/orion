/**
 * Built-in Bracket Pair Colorizer Extension.
 * Colors matching bracket pairs with distinct colors by nesting level.
 */

import type { ExtensionInstance, ExtensionContext } from '../api'

const BRACKET_COLORS = [
  '#FFD700', // Gold
  '#DA70D6', // Orchid
  '#87CEEB', // SkyBlue
  '#98FB98', // PaleGreen
  '#FF6347', // Tomato
  '#DDA0DD', // Plum
]

export const bracketColorizer: ExtensionInstance = {
  id: 'orion.bracket-colorizer',
  manifest: {
    name: 'bracket-colorizer',
    displayName: 'Bracket Pair Colorizer',
    version: '1.0.0',
    description: 'Colors matching bracket pairs by nesting level for better readability',
    publisher: 'orion',
    categories: ['Other'],
    activationEvents: ['*'],
    contributes: {
      configuration: {
        title: 'Bracket Pair Colorizer',
        properties: {
          'bracketColorizer.enabled': {
            type: 'boolean',
            default: true,
            description: 'Enable/disable bracket pair colorization',
          },
          'bracketColorizer.showGuides': {
            type: 'boolean',
            default: true,
            description: 'Show bracket pair guide lines',
          },
        },
      },
    },
  },
  isActive: false,

  activate(context: ExtensionContext) {
    const styleEl = document.createElement('style')
    styleEl.id = 'orion-ext-bracket-colorizer'

    let css = ''
    for (let i = 0; i < BRACKET_COLORS.length; i++) {
      css += `
        .bracket-color-${i} {
          color: ${BRACKET_COLORS[i]} !important;
          font-weight: 500;
        }
        .bracket-guide-${i} {
          border-left: 1px solid ${BRACKET_COLORS[i]}40;
        }
      `
    }

    // Inactive (unmatched) bracket style
    css += `
      .bracket-error {
        color: #FF0000 !important;
        text-decoration: wavy underline #FF0000;
        font-weight: 700;
      }
      .bracket-active-pair {
        background-color: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 2px;
      }
    `

    styleEl.textContent = css
    document.head.appendChild(styleEl)

    context.subscriptions.push({
      dispose: () => styleEl.remove(),
    })

    // Notify editor about bracket colorization
    window.dispatchEvent(new CustomEvent('orion:extension-activated', {
      detail: {
        id: 'orion.bracket-colorizer',
        bracketColors: BRACKET_COLORS,
        feature: 'bracket-colorization',
      },
    }))
  },

  deactivate() {
    const el = document.getElementById('orion-ext-bracket-colorizer')
    el?.remove()
  },
}
