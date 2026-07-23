# Architecture Decision Records

Short records of the *why* behind decisions that shaped this project. The design
doc (`../refill-tracker-design.md`) remains the authoritative spec for what the
tool does today; an ADR captures why it's that way, what else was considered,
and what we gave up — at the moment the decision was made.

## When to write one

Write an ADR only when the decision passes **all three** tests:

1. **Costly to reverse** — undoing it later means significant rework.
2. **Surprising** — a future reader would ask "why on earth did they do it this way?"
3. **A genuine trade-off** — there was a real alternative with real merits, not
   an obvious choice.

Anything failing a test belongs in the design doc (current behavior), a commit
message (small implementation choice), or nowhere. Expect ADRs to be rare —
a handful per version, not one per PR.

## How

- One file per decision: `NNNN-short-kebab-title.md`, numbered sequentially.
- Write it in the same PR as the decision, while the alternatives are fresh.
- ADRs are immutable once accepted. If a decision changes, write a new ADR and
  mark the old one `Superseded by NNNN` — never rewrite history.
- Update the design doc in the same PR so the spec reflects the outcome; the
  ADR holds the reasoning, not the spec.

## Template

```markdown
# NNNN — Title (a decision, phrased as a statement)

- **Status:** Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

What situation forced a choice. The constraints that mattered.

## Decision

What we chose, in one or two sentences.

## Alternatives considered

Each real alternative and the concrete reason it lost.

## Consequences

What this costs us and buys us — including the sharp edges we accepted.
```
