# Protocol compliance status

For **framework maintainers**. The gateway is wire-compatible with the legacy
MTProto server and passes real clients through the full launch (handshake → session
→ business RPC). The MTProto service layer now follows the
[spec](https://core.telegram.org/mtproto); this page is the audit surface — the
status of each service message and the handful of **intentional deviations** that
remain (with their rationale). Treat any new simplification as a row to add here,
plus a compliance test.

Service messages live in [`dispatch/dispatcher.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/dispatch/dispatcher.ts)
(`handleService`); salts in [`auth/handshake.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/auth/handshake.ts)
and the salts repo. Spec references: [Service Messages](https://core.telegram.org/mtproto/service_messages),
[Mobile Protocol](https://core.telegram.org/mtproto/description).

## Compliance matrix

| Area                                 | Spec expectation                                                                                                                               | Current implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **Server salts**                     | A rolling set of 64-bit salts, each valid for a bounded window (~30–60 min) with overlap; the server pre-generates upcoming salts and rotates. | **Per-auth-key salt schedule** ([`session/salts.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/session/salts.ts)): 30-min windows on a 15-min grid (two concurrently valid), minted on demand and persisted in the salts repo so any node validates any salt. Window 0 keeps the legacy `xor(newNonce, serverNonce)` salt for wire-compat.                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ compliant |
| **`get_future_salts`**               | Return up to the requested `num` **future** salts with real `valid_since`/`valid_until` windows.                                               | Returns the next `num` (clamped 1–64) **scheduled** salts from the current window with true windows, minting more if the schedule is short.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ compliant |
| **`bad_server_salt`**                | Emit when the client uses a wrong/expired salt, carrying the correct current salt so the client switches.                                      | The decrypt path validates the envelope salt against the schedule; a wrong/expired salt drops the message and replies `bad_server_salt` (`error_code 48`) with the current salt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ compliant |
| **`msgs_ack`**                       | Track delivery; drive retransmission / `msg_resend_req`; clear server-side resend queues.                                                      | Client acks of server→client messages are accepted and ignored: we never retransmit, so there is no resend queue for an ack to clear. Client messages are acked implicitly by the prompt `rpc_result`/`pong` (the spec permits this in lieu of a standalone ack).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅           |
| **`msgs_state_req`**                 | Report the real per-message state for each requested `msg_id`.                                                                                 | Real per-id state from the per-connection inbound tracker ([`session/inbound-tracker.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/session/inbound-tracker.ts)): received messages → `4` (`+16` for non-content, `+32 +64` for answered queries); unseen ids → `1`/`2`/`3` by position relative to the tracking window.                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅           |
| **`rpc_drop_answer`**                | Cancel an in-flight RPC and report whether it was dropped (`rpc_answer_dropped{_running}`) or already gone.                                    | Returns `rpc_answer_unknown` **wrapped in `rpc_result`** (per spec). Packets are processed serially per connection and answers are sent immediately (no outgoing answer queue), so a drop always arrives after its target was answered — "no memory of `req_msg_id` / already responded" is the correct reply. `rpc_answer_dropped{_running}` are never produced (no in-flight answer to drop).                                                                                                                                                                                                                                                                                                                                                                                      | ✅           |
| **`destroy_session`**                | Verify and tear down the stored session, then `destroy_session_ok` / `_none`.                                                                  | Deletes the stored session if it belongs to this auth key → `destroy_session_ok`; otherwise `destroy_session_none`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅           |
| **`destroy_auth_key`**               | Forget a permanent auth key (`_ok` / `_none` / `_fail`).                                                                                       | Blocks the key in storage (rejecting all later use) → `destroy_auth_key_ok`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅           |
| **`ping` / `ping_delay_disconnect`** | `pong`; the latter arms a timer that closes the connection after `disconnect_delay`s.                                                          | `pong`; `ping_delay_disconnect` arms a per-connection idle timer (closes after `disconnect_delay`s, reset on any inbound traffic).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅           |
| **`msg_resend_req`**                 | Re-send the requested messages, or `msgs_state_info` for any not held.                                                                         | We keep no sent-message store, so we reply `msgs_state_info` for every requested id (the spec's fallback).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅           |
| **`msgs_all_info`**                  | Voluntary status of the peer's messages.                                                                                                       | Accepted and ignored (informational; requires no ack — we don't retransmit).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅           |
| **`msg_container`**                  | Process each inner message; reject a malformed one.                                                                                            | Parsed atomically (≤ 1024 messages, inner lengths bounds-checked); a malformed container replies `bad_msg_notification` `64` and nothing is processed. **Each inner message is validated** like the outer envelope (id `18`/`16`/`17`/`19`/`20` + seqno parity `34`/`35`) — only ordering (`32`) is skipped, so a resend container's old seqnos pass. A bad inner gets its own `bad_msg_notification`; the rest still run.                                                                                                                                                                                                                                                                                                                                                           | ✅           |
| **`http_wait`**                      | Long-poll semantics for the HTTP transport.                                                                                                    | No-op (we run WS/TCP).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ➖ N/A here  |
| **`bad_msg_notification`**           | Reject out-of-range `msg_id`, bad `seqno`, duplicate, etc. with the right error code.                                                          | Inbound validation ([`inbound-tracker.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/session/inbound-tracker.ts)): `msg_id` not divisible by 4 (`18`), >30 s ahead / >300 s behind (`17`/`16`), too old to verify (`20`), duplicate **container** id (`19`); **seqno** parity and ordering (`34`/`35`/`32`, gated by `disableSeqNoCheck`); invalid container (`64`, from the dispatcher). A violation replies `bad_msg_notification` and drops the message without touching the session. A duplicate _regular_ request is answered with `msg_detailed_info` (its reply's `msg_id`/size, cached) — or dropped silently if that reply is no longer cached. Code `33` (seqno too high) is unreachable under serial processing — see _Intentional deviations_. | ✅           |
| **Inbound `msg_key`**                | MTProto 2.0 integrity check.                                                                                                                   | Implemented + enforced (gated by `disableMsgKeyCheck` — see _Opt-in escape hatches_ below for the real-client v1 deviation it covers).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ + shim    |

`✅` = spec-compliant; `➖` = not applicable to this transport; `✅ + shim` = compliant
by default with a documented, opt-in deviation (see _Intentional deviations_).

## The salt subsystem (implemented)

The salts gap was the most substantive; it is now spec-faithful. The design lives
entirely in the gateway's session/crypto seam — the **business** layer is untouched.

1. **Salt schedule per auth key** — [`SaltService`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/session/salts.ts)
   keeps a rolling schedule of `{ salt, validSince, validUntil }` windows. Windows
   are 30 min long on a 15-min grid (`windowSec`/`stepSec`), so two salts are valid
   at any moment and a successor is always ready before the current one expires.
2. **Deterministic grid + persistence** — windows lie on `t0 + k·step`, anchored at
   the first window's `validSince` (`t0`). The anchor is persisted in the salts repo
   (in-memory / Mongo) and `step`/`window` are constants, so every node derives the
   same boundaries; the repo's insert-if-absent (`$setOnInsert`) append converges all
   nodes on one salt per window. Any node validates any salt; expired windows are
   pruned. Window 0 keeps the legacy handshake salt (`xor(newNonce, serverNonce)`)
   for wire-compat.
3. **Decrypt path** ([`message-pipeline.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/server/message-pipeline.ts))
   calls `saltService.resolve(authKeyId, envelopeSalt)`: it advertises the current
   salt (used for all replies) and reports whether the client's salt covers `now`. A
   wrong/expired salt drops the message and replies `bad_server_salt` (`error_code 48`)
   carrying the current salt; the client re-sends with it.
4. **`get_future_salts(num)`** ([`dispatcher.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/dispatch/dispatcher.ts))
   returns the next `num` (clamped 1–64) scheduled salts from the current window with
   their true windows, minting more if the schedule is short.

Covered by [`test/salts.compliance.test.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/test/salts.compliance.test.ts):
a `SaltService` unit test (overlapping 30-min windows, rotation as the clock advances)
plus an e2e pair — `get_future_salts(3)` returns 3 distinct future salts with valid
non-degenerate windows, and a `bad_server_salt` round-trip (wrong salt → corrected).

## Intentional deviations

These are deliberate and bounded — each is a consequence of the gateway's
forward-and-respond, serial-per-connection architecture, not an unfinished stub.
They are the parts that **will not match the spec exactly**, by design.

- **Seqno ordering (`32`) is enforced only on the top-level stream, not inside a
  container.** A resend is sent by wrapping the original message (with its _original_,
  now-old seqno) in a container; enforcing ordering on inner messages would reject a
  legitimately re-sent gap-filler. Inner messages still get parity (`34`/`35`) and the
  `msg_id` checks. Trade-off: an out-of-order inner seqno isn't caught — acceptable,
  since the inner `msg_id` checks still bound replay.
- **Code `33` (seqno too high) is unreachable.** It means a later-`msg_id` message
  with a lower-or-equal odd seqno was already received — impossible under serial,
  in-`msg_id`-order processing. There is nothing to implement.
- **Duplicate handling has no large-answer cache.** A duplicate request gets a
  `msg_detailed_info` pointing at its cached reply `msg_id` + size; we do **not** keep
  the reply _body_ to re-send a large answer (the spec's other option). The client can
  re-request via the normal flow. A duplicate whose reply has aged out of the window is
  dropped silently rather than answered.
- **No retransmission / outgoing answer queue — by design.** Durability is the
  worker's job (pts-log + `updates.getDifference`), not the gateway's; the gateway
  answers immediately and keeps no resend queue. Consequence: `msgs_ack` has nothing to
  clear, `msg_resend_req` falls back to `msgs_state_info`, and `rpc_drop_answer` only
  returns `rpc_answer_unknown` (never `rpc_answer_dropped{_running}` — there is no
  queued answer to drop). Building a durable outgoing queue here is out of scope and
  would duplicate the worker tier.
- **Inbound replay tracking is per-connection-process.** The dedup window
  ([`inbound-tracker.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/src/session/inbound-tracker.ts)) is
  in-memory per connection — not shared across replicas. The time-window check (codes
  `16`/`17`) provides the cross-node guarantee (a stale `msg_id` is rejected on every
  node); exact cross-node dedup would need a shared `msg_id` store (Redis) for little
  marginal gain, so it is intentionally not done.

### Opt-in escape hatches (secure by default)

Two checks are spec-compliant by default but can be disabled for a non-compliant
client — the same pattern, to be removed once clients conform:

- **`disableSeqNoCheck`** (env `DISABLE_SEQNO_CHECK`) — turns off seqno validation
  (codes `32`/`34`/`35`). Enforcing it requires the client to set `seqno` to spec
  (odd for content-related queries, even for pure service messages); a client that
  does not can set this until it is fixed.
- **`disableMsgKeyCheck`** (env `DISABLE_MSG_KEY_CHECK`) — drops the inbound MTProto
  2.0 `msg_key` integrity check. ⚠️ insecure. It exists for one known real-client
  deviation: a mobile client that computes `msg_key` with the MTProto **1.0** scheme
  (SHA-1 over the unpadded plaintext) while deriving AES with the 2.0 KDF. Such
  packets decrypt correctly but their `msg_key` isn't reproducible by a 2.0 server,
  so a compliant server rejects them — the shim accepts them until the client is
  fixed. Keep it `false` otherwise.

Service-message compliance is covered by
[`test/service-messages.e2e.test.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/test/service-messages.e2e.test.ts)
(msg_id + seqno bad_msg, invalid + inner-validated containers, duplicate →
msg_detailed_info, destroy_session/auth_key, msgs_state_req/msg_resend_req,
rpc_drop_answer),
[`test/inbound-tracker.test.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/test/inbound-tracker.test.ts)
(every `bad_msg_notification` code + `msgs_state_info` byte), and
[`test/connection.test.ts`](https://github.com/joeberetta/mt-tl/blob/master/packages/server/test/connection.test.ts) (the
`ping_delay_disconnect` idle timer).

## How to extend this audit

When you touch a service message or a protocol path, check it against the spec and
either implement it faithfully or add a row here with the deviation and its
rationale. Silent simplifications are the thing this page exists to prevent.
