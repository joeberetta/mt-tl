import type {
    WalletsBalance,
    WalletsConfig,
    WalletsCurrenciesList,
    WalletsCurrencyRatesList,
} from '../generated/schema.js'
import { definePlugin } from '../framework.js'

// The `wallets.*NotModified` constructors carry no fields and are wire-valid for
// each result type — a clean "nothing to send" stub. (The generated result types
// collapse to their primary constructor, so the NotModified variant needs a cast.)
const balanceNotModified = { _: 'wallets.balanceNotModified' } as unknown as WalletsBalance
const configNotModified = { _: 'wallets.configNotModified' } as unknown as WalletsConfig
const currenciesNotModified = { _: 'wallets.currenciesListNotModified' } as unknown as WalletsCurrenciesList
const ratesNotModified = { _: 'wallets.currencyRatesListNotModified' } as unknown as WalletsCurrencyRatesList

/**
 * Wallets routes — stubs for the alpha (no service yet). Each returns the
 * `*NotModified` variant so the wallet tab loads; a real version would take a
 * WalletService dependency and return live data.
 */
export const walletsPlugin = definePlugin(app => {
    app.method('wallets.getConfig', async () => configNotModified)
    app.method('wallets.getBalance', async () => balanceNotModified)
    app.method('wallets.getCurrenciesList', async () => currenciesNotModified)
    app.method('wallets.getCurrencyRatesList', async () => ratesNotModified)
})
