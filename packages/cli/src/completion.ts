export const COMPLETION_SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const COMMANDS = "ls cd pwd back refs cat stream find tree check export_graph help";

export function normalizeCompletionShell(value: string): CompletionShell | undefined {
  if (value === "pwsh") return "powershell";
  if ((COMPLETION_SHELLS as readonly string[]).includes(value)) return value as CompletionShell;
  return undefined;
}

export function isCompletionShell(value: string): value is CompletionShell {
  return normalizeCompletionShell(value) !== undefined;
}

export function completionScript(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
    case "powershell":
      return powershellScript();
  }
}

export function completionHelp(): string {
  return `Print a shell completion script (bash, zsh, fish, or powershell/pwsh).

  eval "$(muin completion bash)"
  muin completion zsh > ~/.zfunc/_muin
  muin completion fish > ~/.config/fish/completions/muin.fish
  muin completion powershell | Out-String | Invoke-Expression

See the README for persistent install paths.
`;
}

function bashScript(): string {
  return `# muin bash completion (Linux / macOS)
_muin() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local cmds="${COMMANDS}"
  local flags="--help --version --mcp --max-bytes"

  _muin_pdfs() {
    local i
    COMPREPLY=()
    for i in $(compgen -f -- "\$cur"); do
      if [[ -d "\$i" ]]; then
        COMPREPLY+=("\$i/")
      elif [[ "\$i" == *.pdf || "\$i" == *.PDF ]]; then
        COMPREPLY+=("\$i")
      fi
    done
  }

  if [[ "\$prev" == --max-bytes ]]; then
    return 0
  fi

  if [[ "\$cur" == -* ]]; then
    COMPREPLY=( \$(compgen -W "\$flags" -- "\$cur") )
    return 0
  fi

  local has_mcp=0
  local i
  for (( i=1; i < COMP_CWORD; i++ )); do
    if [[ "\${COMP_WORDS[i]}" == --mcp ]]; then
      has_mcp=1
    fi
  done

  if [[ \$has_mcp -eq 1 ]]; then
    _muin_pdfs
    return 0
  fi

  if [[ \$COMP_CWORD -eq 1 ]]; then
    _muin_pdfs
    local extra
    extra=( \$(compgen -W "help completion \$flags" -- "\$cur") )
    COMPREPLY+=("\${extra[@]}")
    return 0
  fi

  if [[ "\${COMP_WORDS[1]}" == completion ]]; then
    COMPREPLY=( \$(compgen -W "bash zsh fish powershell pwsh" -- "\$cur") )
    return 0
  fi

  local cmd=""
  for (( i=2; i < COMP_CWORD; i++ )); do
    case "\${COMP_WORDS[i]}" in
      ls|cd|pwd|back|refs|cat|stream|find|tree|check|export_graph|help)
        cmd="\${COMP_WORDS[i]}"
        break
        ;;
    esac
  done

  if [[ -z "\$cmd" ]]; then
    COMPREPLY=( \$(compgen -W "\$cmds" -- "\$cur") )
    return 0
  fi

  case "\$cmd" in
    stream)
      COMPREPLY=( \$(compgen -W "--raw --decoded" -- "\$cur") )
      ;;
    find)
      COMPREPLY=( \$(compgen -W "--type --where" -- "\$cur") )
      ;;
    tree)
      COMPREPLY=( \$(compgen -W "--depth" -- "\$cur") )
      ;;
    export_graph)
      COMPREPLY=( \$(compgen -W "--from --depth --find" -- "\$cur") )
      ;;
    help)
      COMPREPLY=( \$(compgen -W "\$cmds" -- "\$cur") )
      ;;
  esac
}

complete -o nospace -F _muin muin
`;
}

function zshScript(): string {
  return `#compdef muin
# muin zsh completion (Linux / macOS)

_muin() {
  local -a cmds flags
  cmds=(ls cd pwd back refs cat stream find tree check export_graph help)
  flags=(--help --version --mcp --max-bytes)

  if (( CURRENT == 2 )); then
    _alternative \\
      'files:PDF:_files -g "*.pdf"' \\
      'setup:setup:(help completion)' \\
      "flags:flag:(\$flags)"
    return
  fi

  if [[ \${words[2]} == completion ]]; then
    _values 'shell' bash zsh fish powershell pwsh
    return
  fi

  if (( \${words[(I)--mcp]} )); then
    _files -g '*.pdf'
    return
  fi

  if [[ \${words[CURRENT-1]} == --max-bytes ]]; then
    return
  fi

  local cmd=""
  local w
  for w in \${words[3,-1]}; do
    case \$w in
      ls|cd|pwd|back|refs|cat|stream|find|tree|check|export_graph|help)
        cmd=\$w
        break
        ;;
    esac
  done

  if [[ -z \$cmd ]]; then
    _describe -t commands 'command' cmds
    return
  fi

  case \$cmd in
    stream) _values 'stream flags' --raw --decoded ;;
    find) _values 'find flags' --type --where ;;
    tree) _values 'tree flags' --depth ;;
    export_graph) _values 'export_graph flags' --from --depth --find ;;
    help) _describe -t commands 'command' cmds ;;
  esac
}

_muin "$@"
`;
}

function fishScript(): string {
  return `# muin fish completion (Linux / macOS)
complete -c muin -f
complete -c muin -s h -l help -d 'CLI usage'
complete -c muin -s v -l version
complete -c muin -l mcp -d 'MCP server on stdio'
complete -c muin -l max-bytes -r -d 'Max PDF size in bytes'
complete -c muin -n '__fish_is_first_arg' -a help -d 'List commands'
complete -c muin -n '__fish_is_first_arg' -a completion -d 'Print completion script'
complete -c muin -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell pwsh'
complete -c muin -n 'not __fish_seen_subcommand_from completion help' -k -a '(__fish_complete_suffix .pdf)'

set -l muin_cmds ls cd pwd back refs cat stream find tree check export_graph help
for c in \$muin_cmds
  complete -c muin -n '__fish_seen_subcommand_from (string match -r ".*\\.pdf\\\$" (commandline -opc))' -a \$c
end

complete -c muin -n '__fish_seen_subcommand_from stream' -l raw
complete -c muin -n '__fish_seen_subcommand_from stream' -l decoded
complete -c muin -n '__fish_seen_subcommand_from find' -l type
complete -c muin -n '__fish_seen_subcommand_from find' -l where
complete -c muin -n '__fish_seen_subcommand_from tree' -l depth
complete -c muin -n '__fish_seen_subcommand_from export_graph' -l from
complete -c muin -n '__fish_seen_subcommand_from export_graph' -l depth
complete -c muin -n '__fish_seen_subcommand_from export_graph' -l find
`;
}

function powershellScript(): string {
  return `# muin PowerShell completion (Windows PowerShell 5.1+ / pwsh on Windows, macOS, Linux)
Register-ArgumentCompleter -Native -CommandName muin -ScriptBlock {
    param(\$wordToComplete, \$commandAst, \$cursorPosition)

    \$cmds = @('ls','cd','pwd','back','refs','cat','stream','find','tree','check','export_graph','help')
    \$flags = @('--help','--version','--mcp','--max-bytes')
    \$shells = @('bash','zsh','fish','powershell','pwsh')

    \$tokens = @(\$commandAst.CommandElements | ForEach-Object { \$_.Extent.Text })
    if (\$tokens.Count -gt 0) { \$tokens = @(\$tokens | Select-Object -Skip 1) }

    function Emit([string[]]\$items) {
        \$items | Where-Object { \$_ -like "\$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(\$_, \$_, 'ParameterValue', \$_)
        }
    }

    function EmitPdfs {
        Get-ChildItem -ErrorAction SilentlyContinue -File -Filter *.pdf |
            Where-Object { \$_.Name -like "\$wordToComplete*" } |
            ForEach-Object {
                [System.Management.Automation.CompletionResult]::new(\$_.Name, \$_.Name, 'ProviderItem', \$_.FullName)
            }
    }

    if (\$wordToComplete -like '-*') {
        Emit \$flags
        return
    }

    if (\$tokens -contains '--mcp') {
        EmitPdfs
        return
    }

    \$argCount = \$tokens.Count
    if (\$argCount -le 1) {
        Emit @('help','completion')
        Emit \$flags
        EmitPdfs
        return
    }

    if (\$tokens[0] -eq 'completion') {
        Emit \$shells
        return
    }

    \$cmd = \$null
    foreach (\$t in \$tokens) {
        if (\$cmds -contains \$t) { \$cmd = \$t; break }
    }

    if (-not \$cmd) {
        Emit \$cmds
        return
    }

    switch (\$cmd) {
        'stream' { Emit @('--raw','--decoded') }
        'find' { Emit @('--type','--where') }
        'tree' { Emit @('--depth') }
        'export_graph' { Emit @('--from','--depth','--find') }
        'help' { Emit \$cmds }
    }
}
`;
}
