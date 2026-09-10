# Data and rule model

All personal configuration and records live in the private spreadsheet. Public code contains only a generic engine and synthetic examples.

## Tabs

| Tab          | Purpose                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| Transactions | Original fields, stable identity, derived classification, and explicit manual overrides |
| Rules        | Private settings, normalization steps, and ordered declarative rules                    |
| Imports      | Export identity, coverage dates, counts, and a digest of the rules used                 |
| Meta         | Schema version, currently 2                                                             |

The application validates tab names and headers before writing. It does not migrate an arbitrary existing financial spreadsheet. Keep existing pivot workbooks until migration/reporting support is designed.

### Upgrade from schema 1

For a Beancounter table created before confidence was removed: finish any pending import with the old app first, then make a private copy of the spreadsheet. Delete column K (`confidence`) in `Transactions` and set `schema_version` to `2` in `Meta`. The new app requires the updated headers and version before loading the table. New tables already use schema 2.

Older rule JSON files still load: obsolete properties are ignored and omitted when rules are saved again. The rule format remains version 1.

## Transaction identity

A fingerprint combines the source account with booking date, value date, original payee, booking text, purpose, canonical amount, and currency. Running balance, filename, row order, and derived classification are excluded.

An occurrence number distinguishes identical rows within an export. Reimporting overlapping complete date ranges retains the existing occurrences and adds only additional ones. This is conservative matching, not a claim of a universal bank transaction ID. If the bank changes source text, or exports filter out some identical transactions, matching may require manual review.

Excluded transactions are retained with an exclusion flag. They are omitted from spending totals but remain available for deduplication and inspection.

Amounts are integer cents in application data. Booking/value dates remain date-only strings. Only EUR account transactions are currently accepted.

## Classification

1. Apply generic Unicode/case/whitespace normalization.
2. Apply private normalization steps in order.
3. Evaluate the first enabled matching private rule.
4. Use the private configured fallback if nothing matches.
5. Apply any manual payee/category override when displaying or reporting.

The Python converter preserves the reference order: exact exclusions, user payee policies, exact historical overrides, context rules, reviewed merchant rules, general merchant rules, and fallbacks.

The review filter shows non-excluded transactions without a matching rule or manual category. A manual category resolves the review item; a payee-only correction does not.

Editing rules affects future imports. Existing stored classifications and manual corrections are preserved; explicit historical reclassification is planned.

## Rules tab

Columns: `kind`, `order`, `enabled`, `spec_json`.

- Exactly one `settings` row defines schema version, categories, fallback labels, and country extraction configuration.
- `normalize` rows define replacement or terminal normalization steps. Order is numeric.
- `rule` rows define conditions and a result. Order is numeric. `enabled` is a spreadsheet boolean.
- A rule's conditions are combined with AND. Fields are `normalized`, `bookingTextNorm`, `purposeNorm`, `foreign`, or an exact `key`.
- Operators are `eq`, `search`, and `full`. The last two interpret a JavaScript regular expression; no expression is executed as JavaScript code.
- Results may specify a payee, use the normalized descriptor, set a category, or exclude the transaction.
- The converter's exact `key` is a serialized seven-field identity; do not hand-author approximate matches for historical exceptions.

Use the private exporter for initial setup. Until the rule editor exists, carefully edit rows directly in Sheets. Normalizer replacement values are literal strings, not backreference expressions. The schema supports the supplied reference; arbitrary Python regex features are not promised to be portable.

Rule evaluation runs in a worker with a timeout so an expensive regex cannot indefinitely freeze the interface.

## Saving

An import writes new transaction rows and its receipt together in one Sheets batch update using explicit cell types. User strings are written as literal strings, never formulas.

The client retains the precise target ranges while the outcome is uncertain. A retry:

1. Reads the sheet and checks for the receipt and transaction IDs.
2. Finishes without another write if the import is already present.
3. Repeats the identical fixed-range write only if the target ranges are still unoccupied.
4. Stops if another edit has changed the expected row counts.

This relies on the agreed single-importer assumption. Do not sort, delete, or otherwise edit rows while an import is pending. Sheets provides atomic batches, not database isolation across separate reads and writes.

## Corrections and backups

Use the app to change payee/category assignments. Clearing a manual override restores the stored automatic value. Imported source fields and IDs should not be edited directly.

The private JSON backup includes transactions, rules, and import receipts. An automatic backup restore interface is not implemented yet. Google Sheets version history and a separately saved export can support manual recovery.

Month-to-date reporting is not implemented. The declared export period is recorded now, but is not treated as proof that pending bank activity or filtered-out transactions were imported.
