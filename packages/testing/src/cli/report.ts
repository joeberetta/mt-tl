import type { RunReport } from './runner.js'

export type ReportFormat = 'pretty' | 'json'

/** Render a {@link RunReport} for the terminal (`pretty`) or machines (`json`). */
export function formatReport(report: RunReport, format: ReportFormat = 'pretty'): string {
    if (format === 'json') return JSON.stringify(report, null, 2)

    const lines: string[] = []
    for (const s of report.steps) {
        const mark = s.ok ? '✓' : '✗'
        const time = `${s.durationMs}ms`
        lines.push(`  ${mark} [${s.user}] ${s.label}  (${time})`)
        if (!s.ok && s.error) lines.push(`      ${s.error}`)
    }
    const passed = report.steps.filter(s => s.ok).length
    const failed = report.steps.length - passed
    lines.push('')
    lines.push(
        `  ${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed ` +
            `(${report.users.length} user${report.users.length === 1 ? '' : 's'}, ${report.durationMs}ms)`,
    )
    return lines.join('\n')
}
