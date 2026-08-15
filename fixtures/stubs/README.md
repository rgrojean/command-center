# fixtures/stubs

Canned `runAgent` outputs for `--stub`. Each file is schema-validated on load.

These encode the *expected demo narrative* (ClaimBridge blocked, portal HIGH,
Cadence migratable, Lighthouse unaffected) so the full pipeline can rehearse
without the SDK. **Live agents must not see these files.** Prompts receive
only the v2/v3 spec diff and the task — never this narrative.

| File | Schema |
|---|---|
| `<slug>.research.json` | `ResearchSpecSchema` (spec minus `downstream_impacts`) |
| `<slug>.human-impact.json` | `HumanImpactSchema` (= `downstream_impacts`) |
| `<slug>.write.json` | `WriteSummarySchema` (only repos that pass the gate and are not blocked) |
