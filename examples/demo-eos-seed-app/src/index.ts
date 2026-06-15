// This is an APP, not a library — it runs from main.ts and exports nothing for
// general use. This tiny surface exists only so a test can EMBED the app:
// @mt-tl/server's e2e (`import … from 'demo-eos-seed-app'`) and this app's unit
// test build the routes via buildDemoApp and drive them. Nothing else needs it.
export { buildDemoApp, type DemoApp } from './app.js'
export { loadEcc } from './modules/auth/index.js'
export { InMemoryUserRepo } from './modules/users/index.js'
