# End-to-End Coverage Boundaries

## Automated local stack (implemented)

Run `pnpm rehearse:local` from the repository root. Three new isolated Anvil
instances/deployments exercise actual CRE CLI BLOCK → new recommended ALLOW,
node-managed synthetic review, durable signing/broadcast, propose/decision/
execute, canonical receipt/state reads, post-sign epoch revocation, replay
rejection and reconstruction of the broadcast service without a duplicate send.

No public RPC/reset target is accepted. Source hashes are checked before and
after every round. Each round gets a new private runtime directory; existing
console flows and signing records are never reset or copied. Evidence marks
hosted Graph, Privy, human review, public Sepolia and hardware TEE as false.

## Browser / provider E2E (not replaced by local tests)

Actual Chrome has been used for loading/source-link/download and refresh/history
checks. That does not complete a real sponsor-integrated wallet flow. The
remaining live acceptance is paused at the user's direction and requires fresh
human review, the separate authority transaction, exact Privy execution, hosted
Graph events, final evidence and three real repeated browser runs.

Do not create an empty test that passes this gate or describe the local harness
as three successful live demos. Scope, failure matrix and tomorrow's actions are
in [the R-11 record](../../docs/release-rehearsal-2026-09-10.md).
