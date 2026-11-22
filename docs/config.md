# Configuration

Project config lives in `.darkforge/config.json`. Only `schemaVersion` is required; every other field falls back to the default below. Objects merge field by field; arrays and scalars in the file replace the default. Unknown extra fields are kept. A field with the wrong type, or a value outside its allowed list, makes the config invalid (the error names the dotted path, for example `models.requireExplicit`). Hooks then fail open with a warning on stderr; CLI commands fail closed with exit 1.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `schemaVersion` | number | `1` | Must be `1`. Anything else is rejected. |
| `project.name` | string | `""` | Project name used in generated text. |
| `project.ownerLanguage` | string | `"en"` | Language skills use when talking to the owner. |
| `gate.command.windows` | string | `""` | Quality gate command on Windows. |
| `gate.command.unix` | string | `""` | Quality gate command on macOS/Linux. |
| `gate.successMarker` | string | `"ALL CHECKS PASSED"` | A line the gate stdout must contain, matched as a whole line after trimming whitespace, to count as passed. |
| `gate.quiet` | boolean | `true` | Show only a short summary of passing gate output. |
| `constraintsPath` | string | `"docs/plans/constraints.md"` | Project global-constraints file, relative to the project root. |
| `riskAreas` | array | `[]` | Areas of the project that always route to high risk. |
| `routing.<risk>.implementer` / `.reviewer` | `{agent, model}` | see below | Agent and model per risk level (`low`, `medium`, `high`). |
| `models.tiers` | array of string | `["haiku","sonnet","opus","fable"]` | Model order, lowest to highest. |
| `models.banned` | array of string | `[]` | Models subagents must never use. |
| `models.requireExplicit` | `"darkforge"` \| `"all"` \| `"off"` | `"darkforge"` | Which Agent calls must pass an explicit `model`: darkforge agents only, all agents, or none. |
| `models.floors` | object (agent -> model) | `{"specialist":"sonnet","security-reviewer":"sonnet"}` | Minimum model per agent short name. Compared by tier order only: a model or floor not listed in `models.tiers` (or a missing model) is never treated as below the floor. Missing models are caught by `requireExplicit`, banned ones by `models.banned`. |
| `escalation.raiseAfterFixRounds` | number | `2` | Fix rounds before raising the implementer's model tier. |
| `escalation.askOwnerAfterFixRounds` | number | `3` | Fix rounds before asking the owner. |
| `git.baseBranch` | string | `"main"` | Branch tasks merge into. |
| `git.remote` | string or null | `"origin"` | Remote name; `null` means local merges only. |
| `git.prFlow` | boolean | `true` | Merge through pull requests. |
| `git.requiredChecks` | array | `[]` | Check names that must pass before merge. |
| `git.mergeMethod` | `"merge"` \| `"squash"` \| `"rebase"` | `"merge"` | How pull requests are merged. |
| `git.autoMerge` | boolean | `false` | Merge automatically when checks pass. |
| `superpowers` | `"auto"` \| `"off"` | `"auto"` | Use the superpowers plugin when installed, or never. |

Default routing:

| Risk | Implementer | Reviewer |
|---|---|---|
| low | builder / sonnet | reviewer / sonnet |
| medium | builder / sonnet | reviewer / opus |
| high | specialist / opus | security-reviewer / opus |

## Known limits

See [Known limits in the user guide](user-guide.md#known-limits).
