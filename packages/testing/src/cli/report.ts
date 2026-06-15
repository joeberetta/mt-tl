import type { RunReport, StepReport } from './runner.js'

export type ReportFormat = 'pretty' | 'json'

/** One step's line: `✓ [user] label  (Nms)` (+ an indented error if it failed).
 *  Used for LIVE progress as each step completes, so the final output doesn't
 *  re-list every step. */
export function formatStep(s: StepReport): string {
    const line = `${s.ok ? '✓' : '✗'} [${s.user}] ${s.label}  (${s.durationMs}ms)`
    return !s.ok && s.error ? `${line}\n      ${s.error}` : line
}

/** The closing summary line. */
export function formatSummary(report: RunReport): string {
    const passed = report.steps.filter(s => s.ok).length
    const failed = report.steps.length - passed
    const users = `${report.users.length} user${report.users.length === 1 ? '' : 's'}`
    return `${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed  (${users}, ${report.durationMs}ms)`
}

/** Render a {@link RunReport}: `json` = the full structured report; `pretty` =
 *  just the summary (steps are shown live as they run, so they aren't re-listed). */
export function formatReport(report: RunReport, format: ReportFormat = 'pretty'): string {
    return format === 'json' ? JSON.stringify(report, null, 2) : formatSummary(report)
}
