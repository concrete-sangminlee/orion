/**
 * Type declarations for packages without built-in types.
 */

declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';
  import type { ChalkInstance } from 'chalk';

  interface MarkedTerminalOptions {
    code?: ChalkInstance;
    blockquote?: ChalkInstance;
    html?: ChalkInstance;
    heading?: ChalkInstance;
    firstHeading?: ChalkInstance;
    hr?: ChalkInstance;
    listitem?: ChalkInstance;
    list?: (...args: any[]) => string;
    table?: ChalkInstance;
    paragraph?: ChalkInstance;
    strong?: ChalkInstance;
    em?: ChalkInstance;
    codespan?: ChalkInstance;
    del?: ChalkInstance;
    link?: ChalkInstance;
    href?: ChalkInstance;
    text?: ChalkInstance | ((t: string) => string);
    unescape?: boolean;
    emoji?: boolean;
    width?: number;
    showSectionPrefix?: boolean;
    reflowText?: boolean;
    tab?: number;
    tableOptions?: Record<string, any>;
  }

  export function markedTerminal(
    options?: MarkedTerminalOptions,
    highlightOptions?: Record<string, any>
  ): MarkedExtension;

  export default class Renderer {
    constructor(options?: MarkedTerminalOptions, highlightOptions?: Record<string, any>);
  }
}
