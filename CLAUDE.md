@AGENTS.md

## Claude Code notes

- Sessions usually run in a worktree under `.claude/worktrees/`. The main checkout is
  `/Users/Kevin/Git/kevinwong.co`. Any command meant for Kevin starts with
  `cd /Users/Kevin/Git/kevinwong.co &&`.
- Preview with the `dev` entry in `.claude/launch.json` (port 3000). /admin is a 404 locally by
  design.
- Before calling a duplicate or dead-code finding new, check [docs/audits/](docs/audits/) and
  TODO.md. Most of them are already listed there with their behaviour caveats.
