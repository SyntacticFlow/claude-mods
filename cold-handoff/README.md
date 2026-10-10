# cold-handoff

`/cold-handoff` summarizes the current session with Haiku and copies a handoff prompt (the summary plus the session's last two messages) to the clipboard, ready to paste into a new session.

## Use

In the session you want to hand off, run `/cold-handoff`. When the toast says it is copied, start a new session and paste.

If no clipboard can be reached, the handoff prompt is printed in the transcript instead so you can copy it by hand.

## Requirements

Access to a Haiku model. The plugin asks for the `haiku` alias, so it uses the newest Haiku your Claude Code version knows.

To install, update or uninstall, see the [repository README](../README.md).
