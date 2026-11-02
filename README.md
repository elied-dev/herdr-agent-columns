# Agent Columns for Herdr

A board layout for [Herdr](https://herdr.dev): agents as cards in status columns, spaces with nested tabs, a live terminal workspace under the board, search, archive and sub-agent groups. See [RECIPE.md](RECIPE.md) for what it does and how it's built. `preview.png` is a real screenshot of the layout, with demo agents.

## Install

Ask your Herdr agent: `Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/elied-dev/herdr-agent-columns`

By hand: copy `layouts/agent-columns.json` and `layouts/agent-columns.svg` into `~/.config/herdr-app/layouts/` and the three `mods/agent-columns*` folders into `~/.config/herdr-app/mods/`. Then `herdr-app do layout.switch '{"name":"agent-columns"}'`.

No network requests, no programs run, no files read outside the mod folders.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/agent-columns-chrome` is based on Herdr App's `workspace-chrome` mod (Apache-2.0) and has been modified: its sidebar-fold button is removed.
