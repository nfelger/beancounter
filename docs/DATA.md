# Data and rule model

All personal configuration and records live in the private spreadsheet. Public code contains only a generic engine and synthetic examples.

## Tabs

| Tab          | Purpose                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| Transactions | Original fields, stable identity, and editable payee/category assignments |
| Rules        | Private settings, normalization steps, and ordered declarative rules      |
| Imports      | Export identity, coverage dates, counts, and a digest of the rules used   |
| Meta         | Schema version, currently 4                                               |

The application validates tab names and headers before writing. It does not migrate an arbitrary existing financial spreadsheet. Keep existing pivot workbooks until migration/reporting support is designed.

### Development resets

Only schema 4 is supported; there is no compatibility or migration path. For an existing development spreadsheet, finish any pending import first and clear the data rows in both Transactions and Imports. Keep Rules and the other headers. Set Transactions E1 to `amount`; clear obsolete columns Q and R if present. Set `schema_version` to `4` in Meta, then reimport the original CSV files. Alternatively, create a new spreadsheet through the app and load your private rules there.

For an existing schema 4 sheet with override columns: copy any non-empty manual payee/category corrections into payee/category first, then delete the entire `manual_payee` and `manual_category` columns (L and M together). Schema version remains 4. The remaining transaction columns run from A to N; the app validates their headers before loading.

## Transaction identity

A fingerprint combines the source account with booking date, value date, original payee, booking text, purpose, canonical amount, and currency. Running balance, filename, row order, and derived classification are excluded.

An occurrence number distinguishes identical rows within an export. Reimporting overlapping complete date ranges retains the existing occurrences and adds only additional ones. This is conservative matching, not a claim of a universal bank transaction ID. If the bank changes source text, or exports filter out some identical transactions, matching may require manual review.

Excluded transactions are retained with an exclusion flag. They are omitted from spending totals but remain available for deduplication and inspection.

Amounts are integer cents in application data. Booking/value dates remain date-only strings internally. Only EUR account transactions are currently accepted.

In Sheets, `booking_date` is a numeric date cell, `amount` is a numeric euro value for pivot sums, and there is no separate cents column. The Sheets adapter divides integer cents by 100 when writing and rounds numeric euros × 100 back to integer cents when reading. It validates numeric types and safe integer bounds; calculations remain in cents inside the app. Import dates, timestamps (UTC), counts, and rule order are numeric cells too. Raw bank fields, including the original value date, remain unchanged in `raw_json`.

The API writes explicit numeric values, avoiding locale-dependent input parsing. It reads unformatted values and date serials, so changing display formats does not change app calculations. German locale displays euro amounts with decimal commas and thousands dots. For pivots, sum `amount`, group `booking_date` by month, and filter out excluded transactions. Do not edit derived financial values directly.

## Classification

1. Apply generic Unicode/case/whitespace normalization.
2. Apply private normalization steps in order.
3. Evaluate the first enabled matching private rule.
4. Use the private configured fallback if nothing matches.
5. Subsequent corrections update payee and category directly; Sheets and the app use the same values.

The Python converter preserves the reference order: exact exclusions, user payee policies, exact historical overrides, context rules, reviewed merchant rules, general merchant rules, and fallbacks.

The review filter shows non-excluded transactions without a matching rule that still have the configured fallback category. Assigning a specific category resolves the review item; a payee-only correction does not. Keeping the fallback category keeps an unmatched transaction in review.

Editing rules affects future imports. Existing assignments are preserved on overlapping reimport.

## Rules tab

Columns A–G: `kind`, `order`, `enabled`, `spec_json`, `pattern`, `payee`, `category`. Existing tables need E1 `pattern`, F1 `payee`, G1 `category` (add columns if needed). Keep existing JSON in D; leave E–G blank for those rows. Schema version remains 4.

- Exactly one `settings` row defines schema version, categories, fallback labels, and country extraction configuration.
- `normalize` rows define replacement or terminal normalization steps. Order is numeric.
- `rule` rows define conditions and a result in `spec_json`; `simple_rule` rows use the cells in E–G instead. Both share one numeric order: smaller first, first matching enabled rule wins. Duplicate priorities are rejected, including disabled rows. Normalization has its own order.
- `enabled` is a spreadsheet boolean/checkbox. Entirely blank rows are ignored; incomplete rows are rejected with a cell address. Filtering or moving rows does not change priority.
- A rule's conditions are combined with AND. Fields are `normalized`, `bookingTextNorm`, `purposeNorm`, `foreign`, or an exact `key`.
- Operators are `eq`, `search`, and `full`. The last two interpret a JavaScript regular expression; no expression is executed as JavaScript code.
- Results may specify a payee, use the normalized descriptor, set a category, or exclude the transaction.
- The converter's exact `key` is a serialized seven-field identity; do not hand-author approximate matches for historical exceptions.

Use the private exporter for initial setup, then edit rules directly in Sheets. Normalizer replacement values are literal strings, not backreference expressions. The schema supports the supplied reference; arbitrary Python regex features are not promised to be portable.

### Simple rules

Set `kind` to `simple_rule`, give it a unique `order`, enable it, and leave `spec_json` empty:

| pattern      | payee    | category |
| ------------ | -------- | -------- |
| `MOONBEAN.*` | Moonbean | Food     |
| `RAILWAY`    |          | Travel   |

These examples are invented. Use your own patterns and configured categories only in your private sheet.

- Patterns match the **whole normalized bank payee**, case-insensitively, after cleanup/normalization. Use `.*` explicitly to allow a prefix/suffix. JavaScript regex syntax applies; enter a single backslash for regex escapes, without JSON escaping or `/…/` delimiters.
- Outputs are literal text, not regex substitutions. Leave payee blank to use the normalized payee; leave category blank to use the configured fallback. At least one assignment must be present.
- A payee-only rule still stops matching. A later category rule does not supplement it.
- Full JSON rules retain `search`, `full`, multiple conditions, and exclusions. Use those for complex cases; E–G must remain empty.
- Simple rules retain their sheet representation when a loaded pack is validated and saved again. The compiled pack uses `sheetFormat: "simple_rule"` to preserve this information; no extra authoring ID is needed. Generated match IDs follow position in the sorted rule list.

In app settings, **Dropdowns und Checkboxen einrichten** installs rule-kind/category dropdowns, enabled checkboxes, header notes, filtering, and plain-text formatting for D–G. It preserves cell values. Run it again after changing configured categories. Loading and saving a rule file also installs these controls; it replaces the rule set as indicated by the confirmation button.

Rules are read afresh for each CSV preview and checked again before saving. Existing imported assignments do not change. If a rule changed during preview, upload the CSV again to review its effect.

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

Use the app or the payee/category cells in Sheets to change assignments directly. There are no separate override columns or automatic values to restore. Imported source fields and IDs should not be edited directly.

The private JSON backup includes transactions, rules, and import receipts. An automatic backup restore interface is not implemented yet. Google Sheets version history and a separately saved export can support manual recovery.

Month-to-date reporting is not implemented. The declared export period is recorded now, but is not treated as proof that pending bank activity or filtered-out transactions were imported.
