# 0004 — Tauri updater uses a public releases-only GitHub repository

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The app is installed on one pharmacy computer, while the source repository is
private. The owner needs a dependable way to publish signed updates without
putting source access or credentials into the installed application.

## Decision

Use `tauri-plugin-updater` with a minisign keypair. Serve signed installers and
`latest.json` from the separate public `Mario-Recondo/mr-refill-tracker-releases`
repository; the app embeds that endpoint and the public key.

## Alternatives considered

- Making the app repository public would expose source and history.
- A token in the app for the private repository would ship a credential in the
  binary and that credential could leak or expire.
- A static host would add infrastructure and cost for one machine.
- Manual reinstalls forever preserve the status quo the owner wants to escape.

## Consequences

The endpoint URL and public key are baked into installed executables. Changing
either requires a staged bridge release: a transitional build signed with the
old key, served from the old endpoint, that embeds the new key or endpoint.
Only losing the private key, its sidecar password file, or endpoint access
without such a bridge forces a manual reinstall, so both the private key and
its password file must be backed up together. CI publishing is deferred; the
owner builds locally and uses the release script.
