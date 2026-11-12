/**
 * Orion CLI - Shell Completion Script Generator
 * Generates auto-completion scripts for bash, zsh, fish, and PowerShell.
 *
 * Usage:
 *   orion completions bash >> ~/.bashrc
 *   orion completions zsh >> ~/.zshrc
 *   orion completions fish > ~/.config/fish/completions/orion.fish
 *   orion completions powershell >> $PROFILE
 */

// ─── Command & Flag Definitions ──────────────────────────────────────────────

const COMMANDS = [
  // Core
  'chat', 'ask', 'explain', 'review', 'fix', 'edit', 'commit',
  // Code
  'search', 'diff', 'pr', 'run', 'test', 'agent', 'refactor', 'compare',
  // Generate
  'plan', 'generate', 'docs', 'snippet', 'scaffold',
  // Tools
  'shell', 'todo', 'fetch', 'changelog', 'log', 'summarize', 'migrate', 'deps', 'format', 'translate', 'env',
  // Analysis
  'debug', 'benchmark', 'security', 'typecheck', 'optimize',
  // Safety
  'undo', 'status', 'doctor', 'clean',
  // Session
  'session', 'watch', 'config', 'init', 'gui', 'completions',
  // Git
  'hooks', 'alias', 'blame',
  // AI
  'learn', 'pair', 'context',
  // Extend
  'plugin', 'api', 'regex', 'cron',
  // Data
  'csv', 'http', 'diff-files', 'stats',
  // Insights
  'map', 'cost',
  // Meta
  'history', 'config-export', 'profile', 'metrics',
  // Help
  'tutorial', 'examples', 'update', 'info',
];

const COMMAND_FLAGS: Record<string, string[]> = {
  fix:       ['--auto', '--max-iterations', '--no-commit'],
  edit:      ['--no-commit'],
  run:       ['--fix'],
  test:      ['--generate'],
  undo:      ['--list', '--file', '--clean'],
  agent:     ['--parallel', '--provider', '--no-save'],
  watch:     ['--on-change', '--debounce', '--ignore'],
  search:    ['--type', '--max', '--no-ai'],
  diff:      ['--staged'],
  refactor:  ['--rename', '--extract', '--simplify', '--unused'],
  generate:  ['--force'],
  todo:      ['--fix', '--prioritize'],
  fetch:     ['--raw'],
  changelog: ['--since', '--days', '--output'],
  migrate:   ['--to'],
  deps:      ['--security', '--outdated', '--unused'],
};

const GLOBAL_FLAGS = ['--json', '-y', '--yes', '--no-color', '--quiet', '--dry-run', '-v', '--version', '-h', '--help'];

// ─── Bash Completion ─────────────────────────────────────────────────────────

function generateBash(): string {
  const flagCases = Object.entries(COMMAND_FLAGS)
    .map(([cmd, flags]) =>
      `      ${cmd})\n        COMPREPLY=($(compgen -W "${flags.join(' ')}" -- "$cur"))\n        return 0\n        ;;`)
    .join('\n');

  return `# Orion CLI bash completions
# Add to ~/.bashrc: eval "$(orion completions bash)"
# Or: orion completions bash >> ~/.bashrc

_orion_completions() {
  local cur prev commands global_flags
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${COMMANDS.join(' ')}"
  global_flags="${GLOBAL_FLAGS.join(' ')}"

  # Complete commands at position 1
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands $global_flags" -- "$cur"))
    return 0
  fi

  # Complete flags for specific commands
  local cmd="\${COMP_WORDS[1]}"
  case "$cmd" in
${flagCases}
  esac

  # Fall back to file completion
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "$global_flags" -- "$cur"))
  else
    COMPREPLY=($(compgen -f -- "$cur"))
  fi
  return 0
}

complete -o default -F _orion_completions orion
`;
}

// ─── Zsh Completion ──────────────────────────────────────────────────────────

function generateZsh(): string {
  const commandDescriptions: Record<string, string> = {
    chat: 'Start an interactive AI chat session',
    ask: 'Ask a quick one-shot question',
    explain: 'AI-powered code explanation',
    review: 'AI code review',
    fix: 'Find and fix issues in a file',
    edit: 'AI-assisted file editing',
    commit: 'Generate AI commit message',
    search: 'Search codebase with AI analysis',
    diff: 'Review git diff with AI',
    pr: 'AI-powered pull request helper',
    run: 'Run a command with AI error analysis',
    test: 'Run tests with AI failure analysis',
    agent: 'Run multiple AI tasks in parallel',
    refactor: 'AI-powered code refactoring',
    compare: 'Compare files or approaches with AI',
    plan: 'Generate implementation plan',
    generate: 'Generate boilerplate code',
    docs: 'AI-powered documentation generator',
    snippet: 'Manage code snippets',
    scaffold: 'Scaffold a new project from template',
    shell: 'AI-enhanced interactive shell',
    todo: 'Scan for TODO/FIXME/HACK comments',
    fetch: 'Fetch URL content',
    changelog: 'Generate changelog from git history',
    log: 'AI-enhanced git log with summaries',
    summarize: 'AI-powered content summarizer',
    migrate: 'AI-powered code migration',
    deps: 'AI-powered dependency analysis',
    format: 'Format code using native formatter or AI',
    translate: 'Translate code comments or text',
    env: 'Environment variable management',
    debug: 'AI-powered debugging assistant',
    benchmark: 'AI-powered performance analysis',
    security: 'Scan for security vulnerabilities',
    typecheck: 'AI-powered type analysis',
    optimize: 'AI-powered performance optimization',
    undo: 'Undo last file change',
    status: 'Show environment status',
    doctor: 'Run full health check',
    clean: 'Clean up Orion data',
    session: 'Manage named AI sessions',
    watch: 'Watch files and auto-run AI actions',
    config: 'Configure API keys and preferences',
    init: 'Initialize Orion config',
    gui: 'Launch Orion desktop app',
    completions: 'Generate shell completion scripts',
    hooks: 'Manage Orion git hooks',
    alias: 'Manage command aliases',
    blame: 'AI-powered git blame analysis',
    learn: 'Analyze codebase patterns',
    pair: 'Start AI pair programming',
    context: 'Manage AI context files',
    plugin: 'Manage Orion plugins',
    api: 'AI-powered API documentation lookup',
    regex: 'AI regex helper',
    cron: 'Cron expression helper',
    csv: 'CSV/JSON data helper',
    http: 'HTTP request helper',
    'diff-files': 'Compare two files with AI',
    stats: 'Project statistics dashboard',
    map: 'Generate repository structure map',
    cost: 'AI usage cost tracker',
    history: 'Show global command history',
    'config-export': 'Export config as portable bundle',
    profile: 'Manage configuration profiles',
    metrics: 'Show usage metrics',
    tutorial: 'Interactive getting-started tutorial',
    examples: 'Show usage examples',
    update: 'Check for updates',
    info: 'Show version and environment info',
  };

  const cmdEntries = COMMANDS
    .map(cmd => `      '${cmd}:${commandDescriptions[cmd] || cmd}'`)
    .join('\n');

  const flagCases = Object.entries(COMMAND_FLAGS)
    .map(([cmd, flags]) => {
      const flagList = flags.map(f => `'${f}[${f}]'`).join(' ');
      return `    ${cmd})\n      _arguments ${flagList} '*:file:_files'\n      ;;`;
    })
    .join('\n');

  return `#compdef orion
# Orion CLI zsh completions
# Add to ~/.zshrc: eval "$(orion completions zsh)"
# Or: orion completions zsh >> ~/.zshrc

_orion() {
  local -a commands
  commands=(
${cmdEntries}
  )

  _arguments -C \\
    '--json[Output structured JSON]' \\
    '(-y --yes)'{-y,--yes}'[Auto-confirm all prompts]' \\
    '--no-color[Disable color output]' \\
    '--quiet[Minimal output]' \\
    '--dry-run[Show changes without writing files]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'orion command' commands
      ;;
    args)
      case $words[1] in
${flagCases}
        *)
          _files
          ;;
      esac
      ;;
  esac
}

_orion "$@"
`;
}

// ─── Fish Completion ─────────────────────────────────────────────────────────

function generateFish(): string {
  const commandDescriptions: Record<string, string> = {
    chat: 'Start an interactive AI chat session',
    ask: 'Ask a quick one-shot question',
    explain: 'AI-powered code explanation',
    review: 'AI code review',
    fix: 'Find and fix issues in a file',
    edit: 'AI-assisted file editing',
    commit: 'Generate AI commit message',
    search: 'Search codebase with AI analysis',
    diff: 'Review git diff with AI',
    pr: 'AI-powered pull request helper',
    run: 'Run a command with AI error analysis',
    test: 'Run tests with AI failure analysis',
    agent: 'Run multiple AI tasks in parallel',
    refactor: 'AI-powered code refactoring',
    compare: 'Compare files or approaches with AI',
    plan: 'Generate implementation plan',
    generate: 'Generate boilerplate code',
    docs: 'AI-powered documentation generator',
    snippet: 'Manage code snippets',
    scaffold: 'Scaffold a new project from template',
    shell: 'AI-enhanced interactive shell',
    todo: 'Scan for TODO/FIXME/HACK comments',
    fetch: 'Fetch URL content',
    changelog: 'Generate changelog from git history',
    log: 'AI-enhanced git log with summaries',
    summarize: 'AI-powered content summarizer',
    migrate: 'AI-powered code migration',
    deps: 'AI-powered dependency analysis',
    format: 'Format code using native formatter or AI',
    translate: 'Translate code comments or text',
    env: 'Environment variable management',
    debug: 'AI-powered debugging assistant',
    benchmark: 'AI-powered performance analysis',
    security: 'Scan for security vulnerabilities',
    typecheck: 'AI-powered type analysis',
    optimize: 'AI-powered performance optimization',
    undo: 'Undo last file change',
    status: 'Show environment status',
    doctor: 'Run full health check',
    clean: 'Clean up Orion data',
    session: 'Manage named AI sessions',
    watch: 'Watch files and auto-run AI actions',
    config: 'Configure API keys and preferences',
    init: 'Initialize Orion config',
    gui: 'Launch Orion desktop app',
    completions: 'Generate shell completion scripts',
    hooks: 'Manage Orion git hooks',
    alias: 'Manage command aliases',
    blame: 'AI-powered git blame analysis',
    learn: 'Analyze codebase patterns',
    pair: 'Start AI pair programming',
    context: 'Manage AI context files',
    plugin: 'Manage Orion plugins',
    api: 'AI-powered API documentation lookup',
    regex: 'AI regex helper',
    cron: 'Cron expression helper',
    csv: 'CSV/JSON data helper',
    http: 'HTTP request helper',
    'diff-files': 'Compare two files with AI',
    stats: 'Project statistics dashboard',
    map: 'Generate repository structure map',
    cost: 'AI usage cost tracker',
    history: 'Show global command history',
    'config-export': 'Export config as portable bundle',
    profile: 'Manage configuration profiles',
    metrics: 'Show usage metrics',
    tutorial: 'Interactive getting-started tutorial',
    examples: 'Show usage examples',
    update: 'Check for updates',
    info: 'Show version and environment info',
  };

  const cmdCompletions = COMMANDS
    .map(cmd => `complete -c orion -f -n '__fish_use_subcommand' -a '${cmd}' -d '${commandDescriptions[cmd] || cmd}'`)
    .join('\n');

  const flagCompletions = Object.entries(COMMAND_FLAGS)
    .map(([cmd, flags]) =>
      flags.map(flag => {
        const longFlag = flag.replace(/^--/, '');
        return `complete -c orion -n '__fish_seen_subcommand_from ${cmd}' -l '${longFlag}' -d '${flag}'`;
      }).join('\n'))
    .join('\n');

  const globalFlagLines = [
    `complete -c orion -l 'json' -d 'Output structured JSON'`,
    `complete -c orion -s 'y' -l 'yes' -d 'Auto-confirm all prompts'`,
    `complete -c orion -l 'no-color' -d 'Disable color output'`,
    `complete -c orion -l 'quiet' -d 'Minimal output'`,
    `complete -c orion -l 'dry-run' -d 'Show changes without writing files'`,
    `complete -c orion -s 'v' -l 'version' -d 'Show version'`,
    `complete -c orion -s 'h' -l 'help' -d 'Show help'`,
  ].join('\n');

  return `# Orion CLI fish completions
# Save to: ~/.config/fish/completions/orion.fish
# Or: orion completions fish > ~/.config/fish/completions/orion.fish

# Disable file completions by default
complete -c orion -f

# Global flags
${globalFlagLines}

# Commands
${cmdCompletions}

# Command-specific flags
${flagCompletions}
`;
}

// ─── PowerShell Completion ───────────────────────────────────────────────────

function generatePowerShell(): string {
  const commandList = COMMANDS.map(c => `'${c}'`).join(', ');

  const flagSwitchCases = Object.entries(COMMAND_FLAGS)
    .map(([cmd, flags]) => {
      const flagList = flags.map(f => `'${f}'`).join(', ');
      return `        '${cmd}' { ${flagList} | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) } }`;
    })
    .join('\n');

  return `# Orion CLI PowerShell completions
# Add to $PROFILE: orion completions powershell >> $PROFILE
# Or: orion completions powershell | Out-File -Append $PROFILE

Register-ArgumentCompleter -Native -CommandName orion -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(${commandList})
  $globalFlags = @(${GLOBAL_FLAGS.map(f => `'${f}'`).join(', ')})

  $tokens = $commandAst.ToString().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)

  # Complete commands
  if ($tokens.Count -le 2) {
    $allOptions = $commands + $globalFlags
    $allOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  # Complete command-specific flags
  $cmd = $tokens[1]
  switch ($cmd) {
${flagSwitchCases}
    default {
      $globalFlags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
    }
  }
}
`;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function completionsCommand(shell: string): Promise<void> {
  const generators: Record<string, () => string> = {
    bash: generateBash,
    zsh: generateZsh,
    fish: generateFish,
    powershell: generatePowerShell,
    pwsh: generatePowerShell,
  };

  const gen = generators[shell.toLowerCase()];
  if (!gen) {
    const supported = Object.keys(generators).join(', ');
    console.error(`Unknown shell: "${shell}". Supported shells: ${supported}`);
    process.exit(1);
  }

  // Output to stdout so users can redirect to their shell config
  process.stdout.write(gen());
}
