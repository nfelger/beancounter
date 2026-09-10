// Optional navigation only. Never expose private financial state through tool output.
export function registerNavigation(
  navigate: (view: 'import' | 'transactions' | 'settings') => void,
): () => void {
  const context = (
    document as Document & {
      modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => unknown }
    }
  ).modelContext
  if (!context?.registerTool) return () => {}
  const controller = new AbortController()
  try {
    void Promise.resolve(
      context.registerTool(
        {
          name: 'open_beancounter_section',
          description:
            'Navigate to Import, Transactions, or Settings. Does not read financial data or save changes.',
          inputSchema: {
            type: 'object',
            properties: {
              section: { type: 'string', enum: ['import', 'transactions', 'settings'] },
            },
            required: ['section'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: unknown) {
            if (
              !input ||
              typeof input !== 'object' ||
              Object.keys(input).length !== 1 ||
              !('section' in input) ||
              !['import', 'transactions', 'settings'].includes(String(input.section))
            )
              throw new Error('Invalid section.')
            const section = input.section as 'import' | 'transactions' | 'settings'
            navigate(section)
            return { section }
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {
      controller.abort()
    })
  } catch {
    controller.abort()
  }
  return () => controller.abort()
}
