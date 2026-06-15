import { describe, it, expect, vi, afterEach } from 'vitest'
import { Connection } from '../src/transport/connection.js'

/**
 * The `ping_delay_disconnect` idle timer: the server closes a connection after
 * `disconnect_delay` seconds of inactivity, reset on any inbound traffic.
 */
describe('Connection idle-disconnect timer', () => {
    afterEach(() => vi.useRealTimers())

    const make = () => {
        let closed = false
        const conn = new Connection(
            1,
            () => {},
            () => (closed = true),
        )
        return { conn, isClosed: () => closed }
    }

    it('closes after the armed delay of inactivity', () => {
        vi.useFakeTimers()
        const { conn, isClosed } = make()
        conn.armDisconnect(30)
        vi.advanceTimersByTime(29_000)
        expect(isClosed()).toBe(false)
        vi.advanceTimersByTime(2_000)
        expect(isClosed()).toBe(true)
    })

    it('resets the timer on activity', () => {
        vi.useFakeTimers()
        const { conn, isClosed } = make()
        conn.armDisconnect(30)
        vi.advanceTimersByTime(20_000)
        conn.resetDisconnect() // inbound activity
        vi.advanceTimersByTime(20_000) // 40s elapsed, but only 20s since the reset
        expect(isClosed()).toBe(false)
        vi.advanceTimersByTime(15_000)
        expect(isClosed()).toBe(true)
    })

    it('is a no-op when not armed, and disarms on delay 0', () => {
        vi.useFakeTimers()
        const { conn, isClosed } = make()
        conn.resetDisconnect() // never armed → no timer
        vi.advanceTimersByTime(100_000)
        expect(isClosed()).toBe(false)

        conn.armDisconnect(10)
        conn.armDisconnect(0) // disarm
        vi.advanceTimersByTime(100_000)
        expect(isClosed()).toBe(false)
    })
})
