# Agent Columns for Herdr

A board layout for [Herdr](https://herdr.dev): agents as cards in status columns, spaces with nested tabs, a live terminal workspace under the board, search, archive and sub-agent groups. See [RECIPE.md](RECIPE.md) for what it does and how it's built. `preview.png` is a real screenshot of the layout, with demo agents.

## Install

Ask your Herdr agent: `Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/elied-dev/herdr-agent-columns`

By hand: copy `layouts/agent-columns.json` and `layouts/agent-columns.svg` into `~/.config/herdr-app/layouts/` and the four `mods/agent-columns*` folders into `~/.config/herdr-app/mods/`. Then `herdr-app do layout.switch '{"name":"agent-columns"}'`.

The Usage dialog (chart icon next to Settings) runs `mods/agent-columns-usage/usage.py` with `python3`: it reads local agent transcripts (`~/.pi/agent/sessions`, `~/.claude/projects`, `~/.codex/sessions`), reads Claude/Codex/Copilot logins (macOS keychain `Claude Code-credentials`, `~/.codex/auth.json`, `~/.pi/agent/auth.json`) and calls their usage endpoints with `curl`. The rest of the layout makes no network requests and runs no programs.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/agent-columns-chrome` is based on Herdr App's `workspace-chrome` mod (Apache-2.0) and has been modified: its sidebar-fold button is removed.
