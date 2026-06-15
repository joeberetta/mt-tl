# Bug report — mobile client computes `msg_key` with the MTProto **1.0** scheme

**Severity:** medium (works today only via a temporary server-side compat shim)
**Component:** mobile client MTProto transport (encrypted message signing)
**Status:** server accepts it for now; **client fix required** to drop the shim
**Date:** 2026-06-12

---

## Summary

On every **client → server** encrypted message, the mobile client computes
`msg_key` using the **MTProto 1.0** algorithm (SHA‑1 over the _unpadded_
plaintext, with no `auth_key` fragment), while deriving the AES‑IGE key/iv with
the **MTProto 2.0** algorithm (SHA‑256 KDF).

The packet therefore **decrypts correctly** (the AES key only depends on the
16‑byte `msg_key` value that travels in the packet, not on how it was computed),
but its `msg_key` is **not reproducible** by a spec‑compliant 2.0 server. A 2.0
server that verifies `msg_key` on inbound messages rejects **100 %** of this
client's traffic.

This is a client‑side spec deviation: per
[core.telegram.org/mtproto/description](https://core.telegram.org/mtproto/description),
`msg_key` for MTProto 2.0 **must** be the SHA‑256 construction below.

## How it was found

Live capture against the gateway (`LOG_LEVEL=trace`) on a freshly handshaked
auth key. For each inbound message we enumerated candidate `msg_key`
computations and compared to the value sent in the packet. The packet value
matched **only** the `SHA1(unpadded)[4:20]` candidate, on every message:

```
packet msg_key:      f7b4b8829b9a0a7f2fcea51265f1e3e2
  sha256 x0 full     f6aad11de83456897b4faf40a474112f   (correct 2.0)        ✗
  sha256 x0 unpadded cbfb118ad802479a831be1cd23359979                        ✗
  sha1   full        6345c570776a4c2b05655521c28bd709                        ✗
  sha1   unpadded    f7b4b8829b9a0a7f2fcea51265f1e3e2   ← client uses this   ✓
```

Decryption with the 2.0 SHA‑256 KDF succeeded throughout (inner methods
`invokeWithLayer` / `initConnection` / `msgs_ack` decoded normally), which
confirms the **key derivation is already 2.0** — only `msg_key` is 1.0.

## Detail — what the client does vs. what 2.0 requires

Let `plaintext` be the inner message
`server_salt(8) ‖ session_id(8) ‖ msg_id(8) ‖ seq_no(4) ‖ length(4) ‖ message`
and `padding` be the 12..1024 random bytes appended for 2.0.

**Client today (1.0 msg_key):**

```
msg_key = SHA1( plaintext )[4:20]          # no padding, no auth_key fragment
```

**MTProto 2.0 (required):**

```
msg_key_large = SHA256( substr(auth_key, 88 + x, 32) ‖ plaintext ‖ padding )
msg_key       = substr(msg_key_large, 8, 16)
# x = 0 for client → server, x = 8 for server → client
```

The AES key/iv derivation the client already uses is the correct 2.0 one and
does **not** need to change:

```
sha256_a = SHA256( msg_key ‖ substr(auth_key, x, 36) )
sha256_b = SHA256( substr(auth_key, 40 + x, 36) ‖ msg_key )
aes_key  = sha256_a[0:8] ‖ sha256_b[8:24] ‖ sha256_a[24:32]
aes_iv   = sha256_b[0:8] ‖ sha256_a[8:24] ‖ sha256_b[24:32]
```

## Impact

- **Integrity check is effectively disabled for this client.** Because the
  server cannot reproduce the client's `msg_key`, it cannot use it to detect
  tampering/corruption of inbound ciphertext. (The gateway still rejects garbage
  via the length/TL sanity checks after decryption, but that is weaker than the
  `msg_key` MAC that 2.0 is designed to provide.)
- **Server compatibility burden.** The gateway verifies inbound `msg_key`
  (MTProto 2.0) by default and **rejects** this client. To keep current clients
  working the gateway must be run with `DISABLE_MSG_KEY_CHECK=true`, which turns
  off inbound ciphertext authentication entirely (insecure). Re‑enable it — and
  delete this workaround — once clients migrate.
- **Outbound is already 2.0.** The server signs server → client messages with
  the 2.0 `msg_key`, and the client decrypts them fine — so the client's 2.0 KDF
  path is exercised and correct.

## Required client change

Replace the inbound `msg_key` computation with the MTProto 2.0 SHA‑256
construction above:

1. Build `plaintext` and append the 2.0 `padding` (12..1024 bytes, total length
   divisible by 16) — **before** computing `msg_key`.
2. `msg_key = SHA256( auth_key[88:120] ‖ plaintext ‖ padding )[8:24]` for
   client → server (`x = 0`).
3. Keep the existing AES‑IGE key derivation (already 2.0) unchanged.
4. No change needed for decrypting server → client (already 2.0).

## Verification after the fix

Run the gateway with the check enabled (default; `DISABLE_MSG_KEY_CHECK` unset). A
compliant 2.0 client's messages pass; a non‑compliant one is dropped, logging
`[enc] msgKey check failed — rejecting` under `MTPROTO_DEBUG=1`. Until the clients
migrate, operators must set `DISABLE_MSG_KEY_CHECK=true` (insecure). Once all
clients are compliant, unset the flag and delete this document.

## References

- Server: the `computeMsgKey` check in
  `packages/server/src/server/message-pipeline.ts` (`handleEncrypted`), gated by
  `PipelineDeps.disableMsgKeyCheck` / `MTProtoConfig.disableMsgKeyCheck`
  (`DISABLE_MSG_KEY_CHECK` env).
- Regression test: `packages/server/test/msg-key.inbound.test.ts`.
- Spec: <https://core.telegram.org/mtproto/description>.
