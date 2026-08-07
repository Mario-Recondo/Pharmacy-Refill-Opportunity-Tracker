# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context** — one product, one package, no monorepo split.

## Before exploring, read these

- **`Design_docs/refill-tracker-design.md`** — the authoritative spec and this
  repo's de-facto domain model. It defines the vocabulary the codebase actually
  uses: the `Pending` / `Checked Out` / `MISSED` status enum, Req Follow Up
  membership, what "Overdue" narrowed to and how it differs from the Call List,
  the lookup vocabularies and their behavior flags, and the verified-never-
  predicted profit rule. Read the relevant section before naming a domain
  concept.
- **`Design_docs/adr/`** — read ADRs that touch the area you're about to work
  in. Each records *why* a costly-to-reverse decision was made; the design doc
  stays the spec of *what is*.
- **`Design_docs/user_stories.md`** and **`Design_docs/user_flows.md`** —
  acceptance criteria per story, and how the technician actually moves through
  the tool. Flow 2 is the core loop.
- **`CONTEXT.md`** at the repo root — does not exist yet. See the note below
  before creating one.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## Note for `/domain-modeling`: don't start a parallel glossary

The default posture of `/domain-modeling` is to create `CONTEXT.md` lazily as
terms get resolved. Here that risks a second glossary drifting against the one
already in `Design_docs/refill-tracker-design.md`, which is mature and is what
the code was written from.

So: **sharpen the design doc in place** rather than restating its terms in a new
`CONTEXT.md`. A root `CONTEXT.md` is worth creating only if it stays a thin
pointer — a short index naming where each concept is defined — never a copy.

## File structure

```
/
├── CLAUDE.md                       ← project instructions (authoritative)
├── AGENTS.md                       ← repo-wide working rules
├── Design_docs/
│   ├── refill-tracker-design.md    ← the spec / domain model
│   ├── user_stories.md
│   ├── user_flows.md
│   └── adr/                        ← architecture decision records
│       └── adr_README.md           ← template + criteria for earning an ADR
├── docs/agents/                    ← this directory (skill configuration)
├── src/                            ← React + TypeScript frontend
└── src-tauri/                      ← Rust shell, migrations
```

**ADRs live in `Design_docs/adr/`, not `docs/adr/`.** This deviates from the
skill template's default on purpose: the location predates these skills, holds
the existing ADRs, and is mandated by `CLAUDE.md`. Do not create `docs/adr/`.

## Use the spec's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal,
a hypothesis, a test name), use the term as the design doc defines it. Don't
drift to synonyms — "call list" and "Req Follow Up" answer different questions
and are not interchangeable; "processed" has a precise meaning (insurance run,
both `new_copay` and `new_profit` entered).

If the concept you need isn't defined yet, that's a signal — either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (derived follow-up + event log) — but worth reopening because…_

Note the bar for writing a *new* ADR is deliberately high here: a decision earns
one only when it is costly to reverse, surprising to a future reader, **and** a
genuine trade-off. The criteria and template are in `Design_docs/adr/adr_README.md`.
