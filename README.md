# claude-mods

Plugins for [Claude Code](https://claude.com/claude-code). This repository is a plugin marketplace named `syntacticflow-claude-mods`.

| Plugin | What it does |
| --- | --- |
| [cold-handoff](cold-handoff/README.md) | `/cold-handoff` summarizes the session with Haiku and copies a handoff prompt (summary plus the last two messages) to the clipboard for a fresh session. |

## Install a plugin

Inside a Claude Code session (2.1.275 or later), one line:

```
/plugin install cold-handoff --marketplace SyntacticFlow/claude-mods
```

From a shell:

```bash
claude plugin marketplace add SyntacticFlow/claude-mods
```

```bash
claude plugin install cold-handoff@syntacticflow-claude-mods --scope user
```

## Update a plugin

Inside a Claude Code session:

```
/plugin marketplace update syntacticflow-claude-mods
```

From a shell:

```bash
claude plugin marketplace update syntacticflow-claude-mods
```

```bash
claude plugin update cold-handoff@syntacticflow-claude-mods --scope user
```

Then run `/reload-plugins` in sessions already open.

## Uninstall a plugin

Inside a Claude Code session:

```
/plugin uninstall cold-handoff@syntacticflow-claude-mods
```

From a shell:

```bash
claude plugin uninstall cold-handoff@syntacticflow-claude-mods --scope user
```

To drop the marketplace too, which also uninstalls every plugin you installed from it:

```bash
claude plugin marketplace remove syntacticflow-claude-mods
```

## Develop a plugin

Run its tests from the repository root:

```bash
claude plugin test cold-handoff
```

Try an edited copy in a terminal session without installing it:

```bash
claude --plugin-dir ./cold-handoff
```
