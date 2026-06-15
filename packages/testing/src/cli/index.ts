// @mt-tl/testing/cli — programmatic surface behind the `mtproto-test` bin:
// the scenario model, the runner, recipes (the auth-extension seam), and the
// reporter. Import from here to embed the runner or to write typed auth recipes.

export { runScenario, type RunOptions, type RunReport, type StepReport } from './runner.js'
export { runFromFiles, type RunArgs } from './run.js'
export { formatReport, formatStep, formatSummary, type ReportFormat } from './report.js'
export { generateScenarioSchema } from './schema.js'
export { lintScenarios, collectScenarioFiles, type LintResult } from './lint.js'
export {
    loadScenario,
    validateScenario,
    type Scenario,
    type Step,
    type TargetSpec,
    type UserSpec,
    type AuthSpec,
} from './scenario.js'
export { loadConfig, applyOverlay, type OverlayConfig } from './config.js'
export {
    loadRecipes,
    loadRecipeModule,
    type Recipe,
    type RecipeMap,
    type RecipeModule,
    type RecipeContext,
} from './recipes.js'
export { match, toUpdatePredicate, type Matcher, type MatchResult } from './match.js'
export { Scope, getByPath, type Generators } from './scope.js'
