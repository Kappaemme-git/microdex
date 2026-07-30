# Custom hooks

Codex does not expose public shortcuts for `approve`, `decline`, `fork-chat`,
or `plan`. To control these actions with local automation, create:

- macOS/Linux: `approve.sh`, `decline.sh`, `fork-chat.sh`, `plan.sh`
- Windows: `approve.ps1`, `decline.ps1`, `fork-chat.ps1`, `plan.ps1`

The bridge only runs these predefined names. It never accepts arbitrary paths
or commands from the mobile app.
