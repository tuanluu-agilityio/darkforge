## Workflow (darkforge)

- One task, one branch, one implementer.
- The reviewer is always a different agent from the implementer.
- Every darkforge agent dispatch sets `model` explicitly. Banned models: {{bannedModels}}.
- Run the quality gate before merging; it must print `{{successMarker}}` as a whole line.
- Merge only through `darkforge task merge`.
- Update the memory bank (`memory-bank/`) after every task.
- Global constraints live in `{{constraintsPath}}`.
- Talk to the owner in {{ownerLanguage}}.
