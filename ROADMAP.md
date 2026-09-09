# Beancounter roadmap

A small household expense tracker: import bank transactions from a phone, classify them with transparent rules, and understand spending.

The priority is reliable everyday use with minimal hosting and maintenance. This is a plan, not a list of implemented features.

Architecture, development conventions, and privacy requirements are documented in [AGENTS.md](AGENTS.md).

## Now — reliable mobile import and persistence

Deliver one complete flow: connect a spreadsheet, choose an ING CSV on a phone, preview processing results, and save new transactions for access from other devices.

### Foundation and setup

- [ ] Scaffold a small TypeScript app with a normal local development workflow.
- [ ] Add meaningful automated checks for parsing, classification, and import reconciliation, using synthetic fixtures.
- [ ] Configure GitHub Actions and Pages deployment from `main`.
- [ ] Document Google Cloud setup: APIs, OAuth consent, test users, web client ID, and authorized origins.
- [ ] Implement Google authorization and spreadsheet creation/connection; use Picker if connecting an existing spreadsheet.
- [ ] Initialize and validate dedicated tabs for transactions, private rules, and import history.
- [ ] Preserve an import preview across token renewal and recoverable save errors.

### Import and classification

- [ ] Support mobile file selection, starting with ING CSV exports.
- [ ] Parse the metadata preamble, semicolon-delimited table, quoted fields, German dates and amounts, and UTF-8/Windows-1252 encodings.
- [ ] Distinguish the two currency columns; keep money as integer minor units in application calculations and dates as date-only values.
- [ ] Detect already-damaged text and malformed files. Handle only known header variants; do not silently guess or repair transaction contents.
- [ ] Port the generic processing engine from the latest supplied Python reference; load all personal matching, normalization, classification, exclusion, and exception rules from the private spreadsheet.
- [ ] Verify Python/JavaScript regex and Unicode behaviour with representative examples.
- [ ] Provide a private way to import the supplied rules and exceptions into the spreadsheet; never add their contents to the repository or app bundle.
- [ ] Preserve original bank fields separately from automatic payee/category assignments, match information, and manual overrides.
- [ ] Preview new, duplicate, excluded, uncategorised/low-confidence, and invalid entries before confirmation.
- [ ] Save imported text as literal values, not spreadsheet formulas.

### Reliable saving and review

- [ ] Identify the source account from export metadata.
- [ ] Detect overlap between imports using stable original transaction fields; exclude running balance and derived classification from matching.
- [ ] Use bank references where reliable, and preserve the multiplicity of legitimately identical transactions. Flag ambiguity instead of silently deleting entries.
- [ ] Record stable import identifiers and reconcile uncertain write outcomes before retrying.
- [ ] Record import time, source file, account, declared export period, and outcome counts.
- [ ] Provide a transaction list with basic payee/category corrections; manual overrides take precedence over automatic results.
- [ ] Document recovery/export options and the limits of the single-importer assumption.

**Done when:** a real export can be imported on a phone and read on another device; importing overlapping data adds only new transactions; an interrupted save can be reconciled safely; legitimate repeated payments remain intact; private data does not appear in public artifacts.

## Next — useful spending views and rule maintenance

- [ ] Show monthly spending by category, with payee breakdowns within each category.
- [ ] Show a category-by-month table with totals.
- [ ] Calculate app reports from transactions rather than depending on the layout of existing spreadsheet pivot tables.
- [ ] Offer a review queue for unmatched or low-confidence classifications.
- [ ] Add a regex rule editor with explicit ordering, validation, sample matches, and an impact preview.
- [ ] Support explicit reclassification of historical transactions while preserving manual overrides.
- [ ] Establish report semantics for income, refunds/reimbursements, internal transfers, excluded transactions, and cash withdrawals.
- [ ] Track import coverage per account and display the reporting cutoff. A latest transaction date is not proof of complete coverage.

Rules can initially be maintained directly in their spreadsheet tab. Proposed default: rule changes affect future imports; historical reclassification requires an explicit action.

**Done when:** monthly totals reconcile with the agreed transaction set, both requested pivot-style views are usable on mobile, and rule changes can be understood before they are applied.

## Later — budgets and month-to-date comparisons

- [ ] Configure monthly budgets by category, with effective months so budget changes preserve historical comparisons.
- [ ] Show actual spending, remaining budget, and variance per category.
- [ ] Compare month-to-date spending with the same day-of-month in the previous month.
- [ ] Compare with averages of the equivalent month-to-date periods across the previous 3, 6, and 12 months.
- [ ] Show absolute and percentage differences, handling zero baselines explicitly.
- [ ] Use a visible, coverage-aware cutoff rather than comparing an incomplete import with a later historical date.
- [ ] Define shorter-month handling and show how many complete historical months contribute to each average.

Proposed defaults: use booking dates; cap comparison days at the end of shorter months; exclude incomplete historical periods and label insufficient history. Confirm these semantics before implementing comparisons.

**Done when:** comparisons use comparable periods and sufficient imported history, with budgets and reporting assumptions visible to the user.
