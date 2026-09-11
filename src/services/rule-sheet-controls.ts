import { RULE_HEADERS } from './sheet-rules'

export function ruleSheetControls(sheetId: number, categories: string[]) {
  const column = (index: number) => ({
    sheetId,
    startRowIndex: 1,
    startColumnIndex: index,
    endColumnIndex: index + 1,
  })
  const dropdown = (index: number, values: string[]) => ({
    setDataValidation: {
      range: column(index),
      ...(values.length
        ? {
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: values.map((userEnteredValue) => ({ userEnteredValue })),
              },
              strict: true,
              showCustomUi: true,
            },
          }
        : {}),
    },
  })
  return [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: RULE_HEADERS.length,
          },
        },
      },
    },
    dropdown(0, ['simple_rule', 'rule', 'normalize', 'settings']),
    {
      setDataValidation: {
        range: column(2),
        rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
      },
    },
    dropdown(6, categories),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: [
          {
            values: [
              'simple_rule: Regex und Zuordnung in E–G. Andere Arten: JSON in D.',
              'Ganze Zahl. Kleinere Zahl zuerst; gemeinsame eindeutige Reihenfolge für rule und simple_rule.',
              'Aktivieren, um die Regel beim nächsten Import anzuwenden.',
              'Bei simple_rule leer lassen. Sonst vollständige JSON-Spezifikation.',
              'Regex für den gesamten normalisierten Empfänger, ohne Beachtung der Groß-/Kleinschreibung. .* erlaubt ausdrücklich weitere Zeichen.',
              'Wörtlicher Empfängername. Leer: normalisierten Empfänger verwenden.',
              'Kategorie aus den Einstellungen. Leer: Fallback-Kategorie. Mindestens F oder G ausfüllen; die erste passende Regel gewinnt.',
            ].map((note) => ({ note })),
          },
        ],
        fields: 'note',
      },
    },
  ]
}
