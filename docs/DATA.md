# Data and rule model

All personal configuration and records live in the private spreadsheet. Public code contains only a generic engine and synthetic examples.

## Tabs

| Tab          | Purpose                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| Transactions | Original fields, stable identity, derived classification, and explicit manual overrides |
| Rules        | Private settings, normalization steps, and ordered declarative rules                    |
| Imports      | Export identity, coverage dates, counts, and a digest of the rules used                 |
| Meta         | Schema version, currently 4                                                             |

The application validates tab names and headers before writing. It does not migrate an arbitrary existing financial spreadsheet. Keep existing pivot workbooks until migration/reporting support is designed.

### Development resets

Only schema 4 is supported; there is no compatibility or migration path. For an existing development spreadsheet, finish any pending import first and clear the data rows in both Transactions and Imports. Keep Rules and the other headers. Set Transactions E1 to `amount` and Q1 to `value_date` (add column Q if needed); clear the obsolete R1 header if present. Set `schema_version` to `4` in Meta, then reimport the original CSV files. Alternatively, create a new spreadsheet through the app and load your private rules there.

## Transaction identity

A fingerprint combines the source account with booking date, value date, original payee, booking text, purpose, canonical amount, and currency. Running balance, filename, row order, and derived classification are excluded.

An occurrence number distinguishes identical rows within an export. Reimporting overlapping complete date ranges retains the existing occurrences and adds only additional ones. This is conservative matching, not a claim of a universal bank transaction ID. If the bank changes source text, or exports filter out some identical transactions, matching may require manual review.

Excluded transactions are retained with an exclusion flag. They are omitted from spending totals but remain available for deduplication and inspection.

Amounts are integer cents in application data. Booking/value dates remain date-only strings internally. Only EUR account transactions are currently accepted.

In Sheets, `booking_date` and `value_date` are numeric date cells, `amount` is a numeric euro value for pivot sums, and there is no separate cents column. The Sheets adapter divides integer cents by 100 when writing and rounds numeric euros × 100 back to integer cents when reading. It validates numeric types and safe integer bounds; calculations remain in cents inside the app. Import dates, timestamps (UTC), counts, and rule order are numeric cells too. Raw bank fields remain unchanged in `raw_json`.

The API writes explicit numeric values, avoiding locale-dependent input parsing. It reads unformatted values and date serials, so changing display formats does not change app calculations. German locale displays euro amounts with decimal commas and thousands dots. For pivots, sum `amount`, group `booking_date` by month, and filter out excluded transactions. Do not edit derived financial values directly.

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
