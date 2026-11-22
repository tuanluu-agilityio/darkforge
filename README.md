# darkforge

A Claude Code plugin for spec-driven, token-economical project work. It routes each task to the right model tier, plans phases and task packages, runs tasks through a quality gate with an independent review, and keeps a token ledger. No npm dependencies, no network access (except `git` and `gh`), no telemetry.

## Install

```
/plugin marketplace add <github-user>/darkforge
/plugin install darkforge@darkforge
```

## Requirements

- Claude Code with plugin support
- Node.js 18 or newer
- `git`; `gh` is optional (pull requests)
- Windows, macOS or Linux

## Credits

- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT) inspired the skill-driven workflow.
- grill-me by Matt Pocock (MIT) inspired the interview-style planning skill.

No text from either project is copied here.

## License

MIT. See [LICENSE](LICENSE).
