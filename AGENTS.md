# Agent instructions for Beancounter

These instructions apply to the entire repository. See [ROADMAP.md](ROADMAP.md) for delivery priorities and planned features.

## Architecture

- Build a static Vue + TypeScript web app with Vite, hosted on GitHub Pages.
- Use Vue single-file components, the Composition API, scoped/shared CSS, and local reactive state. Keep domain logic framework-independent.
- Use Papa Parse for CSV mechanics, Zod for data validation, Vitest for domain/service tests, and Playwright for the key browser journeys. Use npm with its committed lockfile, ESLint, and Prettier.
- Use one private Google spreadsheet for cross-device persistence, accessed directly from the browser through Google's APIs.
- Use Google’s official Identity Services SDK for browser OAuth and maintained type declarations for Google APIs; keep app-specific adapters small.
- Use Google accounts, OAuth consent, and spreadsheet sharing permissions for access. Prefer `drive.file` with an app-created spreadsheet or Google Picker for an existing spreadsheet.
- Run CSV parsing, generic cleanup, rule evaluation, and reporting in the browser.
- Keep transactions, regex rules, personal normalization mappings, classification/exclusion rules, transaction exceptions, budgets, and import history in the private spreadsheet.
- Load private rules only at runtime after Google authorization. The public app contains the generic processing engine and rule schema, not the user's rule values.
- Do not introduce Apps Script, a custom backend, SQLite, GitHub login, or offline write synchronization.
- Design for one importer for now. Concurrent writes are out of scope; duplicate detection and recovery after uncertain writes are required.
- Minimize operational overhead. Revisit architecture only when requirements such as concurrent importers, background synchronization, or stronger storage guarantees warrant it.

## Privacy: prevent accidental financial disclosure

This repository and its deployed static assets are public. Preventing disclosure is a core requirement, including when handling data that looks like harmless configuration.

- **The user's regex rules must never enter this repository or its Git history.** Merchant patterns, normalized payees, category assignments, exclusions, and exceptions disclose financial activity and personal relationships. Their authoritative home is the private spreadsheet.
- Treat supplied Python scripts containing personal rules as private reference material. Do not copy them into the checkout, commit them, or translate their embedded values into public TypeScript, JSON, seed files, documentation, comments, or fixtures.
- Never commit real transaction CSVs, exports, account identifiers, balances, transaction references, budgets, credentials, or other personal financial details.
- Renaming people or redacting an account number does not make a real financial dataset safe for publication. Use independently invented synthetic examples for tests and demos, including synthetic regex rules.
- Keep private input files and migration outputs outside the repository checkout. Add appropriate ignore patterns as defense in depth; `.gitignore` alone is not a privacy guarantee.
- Generic import/migration tools may be committed, but their private inputs and outputs must not be. Transfer actual rules directly through an authorized private workflow into the spreadsheet.
- Do not embed private data or rule values in static bundles, source maps, public assets, build-time configuration, CI artifacts, screenshots, logs, issue descriptions, PRs, or commit messages.
- Do not send financial data or rules to analytics, telemetry, or third-party error reporting. Error messages should describe the failure without echoing sensitive rows or rule contents.
- Keep OAuth access tokens out of Git, logs, URLs, and build artifacts. The browser OAuth client ID is public configuration; this architecture does not require a client secret in the frontend.
- Before every commit, review the exact file list and diff for sensitive data, including generated files and fixtures. Before deployment, inspect the output for accidental inclusion of private inputs.
- If private data is found in a proposed change, remove it before committing. If disclosure has already occurred, stop further publication, inform the user without repeating the data, and agree on remediation. Deleting a file in a later commit does not remove it from history.

## Development and delivery

- Work trunk-based: make small, coherent commits directly to `main`. Do not create feature branches or require pull requests.
- Before implementation, identify commit-sized increments with one purpose each. Implement, verify, review, and commit each increment before starting the next; do not accumulate a whole roadmap milestone into one commit. Keep intermediate commits buildable, with relevant tests alongside the change.
- Preserve unrelated changes. Do not force-push or rewrite history as routine development.
- Use a conventional local TypeScript development workflow and maintain the project's chosen package manager and lockfile once established.
- Configure GitHub Actions to test, build, and deploy successful changes to Pages. Until configured, do not claim these checks or deployment exist.
- Test meaningful failure modes: parsing, encoding, regex/Unicode parity, legitimate repeated transactions, overlapping imports, and uncertain save outcomes.
- Run `npm run check` and `npm run format:check` before publishing code. The optional browser suite is `npm run test:e2e`; document when browser or live Google validation has not run.
- Financial data and tokens normally stay in memory. An unconfirmed import alone may be held in tab-scoped sessionStorage for recovery; clear it immediately after verified success. Never store OAuth tokens there or add general persistent financial caching.
- Preserve original bank fields separately from derived classifications and manual overrides. A rule update must not silently erase a manual correction.
- Treat imported strings as literal spreadsheet values, not executable formulas.
- Keep architecture, workflow, and privacy requirements here; keep now/next/later priorities in `ROADMAP.md`.
- Report implementation and verification status accurately, including unavailable integrations or blocked writes.
