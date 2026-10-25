# Team mode ("Modo time")

Several computers in one office over the local network. Each person keeps their own AI Office; a **host** collects what the
**members** choose to show and sends everybody the merged picture, which each office draws as extra rooms, read-only.

This is the most security-sensitive feature of the project: it is the only one that opens a listening port beyond
`127.0.0.1` and the only one that sends information about your sessions to another computer. The design below starts from
the threats and everything after it follows from them.

Decisions taken by the maintainer: **local network only, pairing code, off by default, authenticated, read-only between
machines.**

## 1. Goals and non-goals

Goals

- See, in your office, the agents of your teammates: who is working, who needs them, what kind of work.
- Nothing is shared by accident: the default is the least that is still useful, every extra is a per-category opt-in.
- A stranger on the same network learns nothing and can do nothing (no data, no join, no way to reach the web app).
- Pairing is easy for people (type 8 characters) and hard to abuse.

Non-goals

- No internet mode, relay, account service, NAT traversal or discovery protocol (nothing is announced on the network).
- No remote control: a remote agent cannot be messaged, answered, opened in a terminal or hired into. The protocol has no
  message that could carry such an action; the page offers none.
- No sharing of transcripts, permissions, messages or hiring, ever. No chat.
- No protection against a malicious **host or member who is already in the team**: what a member shares, the host and every
  other member can read (the page says so where the person decides).

## 2. Assets

| Asset | Why it matters |
| --- | --- |
| The content of the sessions (prompts, replies, commands, files, paths) | Private work. Must not leave the computer, except the opt-in categories of section 7. |
| The local API (permissions, messages, terminal, hire) and the access token | They act on sessions. Must stay unreachable from the network. |
| The pairing code | Authorizes joining a team for ten minutes. |
| The host's identity key and the members' keys | Prove who is who after pairing. |
| The team membership list | Decides who receives the merged view. |

## 3. Adversaries

| Adversary | Can | Cannot (assumed) |
| --- | --- | --- |
| **A: passive eavesdropper** on the LAN (shared Wi-Fi) | Record every packet, including a whole pairing. | Break X25519, AES-256-GCM, Ed25519, HMAC-SHA-256, scrypt. |
| **B: active attacker** on the LAN (ARP spoofing, rogue access point, rogue process on the host's address) | Drop, delay, modify, replay, inject packets; connect to the listener any number of times; answer on the host's address. | Read the screen of a team member or the host's disk. |
| **C: another local user or program** on a member's or host's computer | Connect to loopback ports, read world-readable files. | Read the owner's `0600` files or know the access token (same as today's threat model of the local server). |
| **D: a member who was removed**, or a leaked old pairing code | Keep what it stored. | Pass authentication after being removed. |
| **E: a web page** in the person's browser | Make requests to `127.0.0.1` and to LAN addresses. | Read the access token or pass the `Sec-Fetch-Site` check (as today). |
| **F: a malicious member or host** | Send arbitrary bytes after authenticating. | Run code, exhaust memory or disk, forge another member (bounded by caps and the strict reader). |

Out of scope: someone with the unlocked computer, malware running as the user, a compromised router that is also given
the pairing code and the host's key, traffic analysis (who talks to whom and how often is visible on the LAN).

## 4. Threats and the answer to each

| # | Threat | Answer |
| --- | --- | --- |
| T1 | The team port exposes the web app, the local API or transcripts. | The team listener is a different server (`node:net`, not `node:http`) that speaks only the framed team protocol. It has no routes, no files, no HTTP. Any other first bytes (an HTTP request, a scanner) exceed the frame limit or fail to parse and the connection is closed **without a reply**. The REST endpoints that manage team mode live on the loopback server only and are local-only, token-protected and `Sec-Fetch-Site`-guarded. The main listener and its guards are unchanged. |
| T2 | The port is reachable from the internet or an unintended network. | Binding is to **one chosen interface address**, never `0.0.0.0` or `::`. Only private, link-local, shared (100.64.0.0/10) and loopback IPv4 literals are accepted, and the address must belong to an interface of this computer. The shared range is also used by carrier-grade NAT, where strangers of the same provider could reach the port, so listening there needs an explicit confirmation in the dialog (and is not resumed after a restart without it). The listener also drops peers whose source address is not in those ranges (a port forward shows a public source). Joining accepts the same literals only: no names, so no DNS and no way to aim a connection at the internet. Off until the person turns it on. |
| T3 | An eavesdropper reads or alters the shared data. | No data travels in clear text. After the handshake every message is AES-256-GCM with a key per direction. Plain HTTP (or any cleartext) on the LAN is **not used for data** because anyone on the network could read agent names and activity and could rewrite them; the whole point of the mode is that the LAN is not trusted. |
| T4 | A man in the middle during pairing hands out its own keys. | Pairing is authenticated by the code, which never crosses the wire: both sides prove knowledge of a key derived from it (scrypt, then HKDF) over the whole transcript (both ephemeral public keys, the nonce, the salt, the ciphertext). A relay that changes a byte breaks the proof; an attacker who does not know the code cannot produce either proof. The member ends the pairing knowing the host's long-term public key; that key is then pinned. Both dialogs show the host key's **fingerprint**, so two people can also compare it out loud. |
| T5 | Guessing the code online, or keeping the pairing unusable. | 8 characters of a 32-symbol alphabet (40 bits), single use, valid 10 minutes (by a monotonic clock, so changing the system time cannot stretch it). While **no code is open the host answers a pairing hello with silence**; with a code open it reveals nothing keyed by the code before the member has proven it. Wrong proofs are counted **per source address**: 5 lock the code for that address only, so a stranger cannot spend the attempts of everybody (60 wrong proofs in all, from many addresses, destroy it); each address may make 2 wrong proofs and 10 pairing attempts a minute, and is then answered `rate-limited`. The code is used up only after the member is stored (a pairing that fails on the host's side leaves it usable). |
| T6 | Guessing the code offline from a recorded handshake. | The proofs are the only values an observer can test a guess against. The code is stretched with scrypt (N=2^15, r=8: 32 MiB, about 80 ms) with a public random salt per code, so each of the 2^40 candidates costs the attacker that much, and the code is dead after at most ten minutes or its first success. A true PAKE would remove the oracle altogether; Node has none and a hand-made one would be riskier than this (see section 9). |
| T7 | Stealing a session by replaying captured traffic. | Handshakes use fresh ephemeral keys and nonces on both sides and the signatures cover them: a recorded `auth` never verifies in a new session. Inside a session each frame is sealed with a counter that is the GCM nonce and part of the key schedule; the counter is **not sent** but counted by both ends, so a replayed, duplicated, dropped or reordered frame fails authentication and the connection ends. Keys are fresh per connection, so a nonce is never reused under a key. |
| T8 | Impersonating a member or the host after pairing. | Each machine has an Ed25519 identity. The host stores only the members' **public** keys (no member secret exists on the host to steal or hash); a member pins the host's public key at pairing. Every session signs a transcript with both identity keys, both ephemeral keys, both nonces and the status. A host key that does not match the pinned one makes the member refuse to continue (it has sent nothing but its id and a fresh ephemeral key) and show `host-key-changed` as a warning; it keeps checking every 60 s, because whoever can answer on that address can also forge this failure, and a forged answer must not be able to switch a member off. |
| T9 | A forged "you were removed" message that makes devices leave, or hides a real one. | The host's answer to a hello carries a status (`ok`, `revoked`, `unknown`) inside the signed transcript. A refusal that is not signed by the pinned key is a host-key warning, never a removal. Only signed statuses and sealed `bye` messages (`revoked`, `ended`) stop a member for good; every error that anyone on the network could produce (version mismatch, rate limit, a wrong key) only slows the retries. |
| T10 | A removed member keeps access. | Revoking deletes its public key, adds its id to the removed list, closes its connection with `bye revoked`, **cuts every handshake it has in progress**, and answers every later hello with a signed `revoked`. A handshake that finishes anyway is refused because the host checks, right before the session starts and on every frame, that the member id is still in the list with the key it proved. Ending the team deletes the identity key and the member list, and nothing may write the host file again: nobody can pair or reconnect to the old team. |
| T11 | Denial of service of the host (connections, memory, CPU). | Frame size limits per phase (4 KB before authentication, 64 KB member to host, 512 KB host to member), at most 64 queued frames, a write backlog cap, a **2 s deadline for the first frame** (an idle connection is cut long before the 8 s handshake deadline), unauthenticated connections capped at 32 in total, 3 per address and 8 per /24 subnet, the **oldest connection of the busiest address dropped** when the total is reached, a reserve of 8 for addresses that authenticated in the last 10 minutes (they are never the ones dropped), 40 messages per 10 seconds per authenticated connection, at most 16 members, 40 agents and 16 rooms per share, heartbeats (ping every 10 s, dead after 35 s). The pairing key is stretched once per code, not per connection. |
| T12 | A member sends hostile content (huge strings, control or bidi characters, HTML, nested objects, catalog keys). | The host rebuilds every share and view from an **allowlist** (`parseTeamShare`, `parseTeamView`): unknown fields are dropped, texts are normalized to NFC and stripped of control, format (zero-width, bidi), line-separator, variation-selector and tag characters, runs of combining marks are cut, lengths are capped, numbers are bounded, unknown enums are refused, and keys and ids may not be `__proto__`, `constructor` and the like. A member can never make another computer render a catalog key of its choice: `activityMsg` is accepted only if its key is one of the activity messages of the shared catalog (never the ones that carry a prompt or a message), only together with the words it renders, and the translator reads own catalog keys only. The page renders everything with `textContent`. Members apply the same readers to the host's view. |
| T13 | The shared data contains more than the person meant. | The share is built by one function, `buildTeamShare`, from an allowlist, with a property test over random offices that carry markers in every sensitive field. See section 7. |
| T14 | A web page in the browser (E) drives team mode or reads the pairing code. | The management endpoints are loopback-only, require the access token, reject cross-site requests and need JSON with a same-origin `Origin`, like every other local-only endpoint. The code is only in the response to an authorized local `GET /api/team`. |
| T15 | Secrets at rest. | `<stateDir>/team/` is `0700`, files `0600`, written atomically (a failed write removes its temporary file, deleting a file removes leftovers). They hold the identity private keys (needed to sign), public keys, names and addresses. No code, no session key and no data from other machines is written. |
| T16 | Clock differences break expiry or ordering. | The protocol carries **ages** (milliseconds ago), never clock readings; each computer converts to its own clock on receipt. The only clock that matters is the host's own for the ten-minute code. Skew between machines has no effect. |
| T17 | A downgrade to an older protocol. | Version 1 is the only one; the version is in the first message and in the signed transcript. A different version is answered with `version-mismatch` before anything else. |
| T18 | Lost updates: two changes to the host file (a removal, a new member, a last-seen update, a member leaving) overwrite each other and bring a removed member back. | Every change goes through one queue and is computed from the latest state, never from a copy taken earlier; management actions of the service are queued too. Background writes stop with the listener. |

## 5. Architecture

```
member computer                                host computer
┌────────────────────────┐                    ┌─────────────────────────────┐
│ web app ── 127.0.0.1 ──┤                    │ web app ── 127.0.0.1 ───────┤
│ main server (unchanged)│                    │ main server (unchanged)     │
│  └ TeamService         │   framed, encrypted│  └ TeamService              │
│     TeamMember ────────┼───── LAN TCP ─────▶│     TeamHost (listener on   │
│                        │                    │       one LAN address)      │
└────────────────────────┘                    └─────────────────────────────┘
```

- `packages/shared/src/team/`: the contract. Types, the pairing-code alphabet, the **sanitizer**, the strict readers.
- `packages/server/src/team/`: `keys` (node:crypto primitives), `conn` (framing), `secure-channel` (AEAD lanes),
  `pairing` (the code), `pair` and `session` (the two handshakes), `host`, `member`, `service`, `store`, `addresses`.
- `packages/server/src/http/handlers/team.ts`: management endpoints on the loopback server.
- The web app draws the others from `OfficeSnapshot.team` and manages the mode with `/api/team`.

Roles: a computer is a host **or** a member of one team, never both. The host also shares its own office, with its own
sharing settings, like any member.

## 6. Protocol (version 1)

### 6.1 Frames

TCP, one frame = `u32 big-endian length || body`. Length 0 or above the phase limit closes the connection at once.
Before the keys exist, bodies are small JSON objects `{ "t": <type>, "v": 1, ... }` with base64 fields (strict: it must
round-trip). After the keys exist, a body is `AES-256-GCM(JSON) || 16-byte tag`.

### 6.2 Primitives (all `node:crypto`)

X25519 (ephemeral key agreement), Ed25519 (identities), HKDF-SHA-256, HMAC-SHA-256, scrypt (N=2^15, r=8, p=1), AES-256-GCM,
`timingSafeEqual` for every comparison of proofs. `transcript(label, parts…)` is SHA-256 over the label and the
length-prefixed parts, so two different lists never hash alike.

### 6.3 Pairing (a new device joins with the code)

```
M -> H  pair-hello      eM
H -> M  pair-challenge  eH, nH (16 random bytes), salt (16 random bytes, per code)
          both: codeKey = scrypt(code, salt); kMac = HKDF(codeKey, salt, "pair mac")
                tr = transcript("pair", eM, eH, nH, salt)
                keys = HKDF(X25519(eM,eH) || codeKey, tr, "pair keys", 64)   // member->host || host->member
M -> H  pair-proof      box  = AEAD(keys.m2h, { name, device, member public key }, aad = tr)
                        proofM = HMAC(kMac, "member" || tr || SHA-256(box))
H:      constant-time check of proofM. Wrong: count it for the source address, answer one generic error `pairing-failed`.
        Right: claim the code (exactly one connection wins, even in a race), decrypt, store the member's PUBLIC key;
        the code is used up only once the member is stored.
H -> M  pair-accept     box' = AEAD(keys.h2m, { memberId, teamId, teamName, hostName, host public key })
                        proofH = HMAC(kMac, "host" || tr || proofM || SHA-256(box'))
M:      constant-time check of proofH, then pins the host public key.
```

The host sends nothing derived from the code before `proofM` verified, and answers a `pair-hello` with silence while no
code is open (a stranger learns nothing, not even that pairing exists; a member who gets silence reports "no open code or
not listening"). A host that does not know the code cannot produce
`proofH`. Pairing then closes; the member opens a normal session.

### 6.4 Session (every connection after pairing)

```
M -> H  hello     memberId, eM, nM
H -> M  hello-ok  eH, nH, status (ok | revoked | unknown), sig = Ed25519_host(tr_host)
M:      checks sig against the PINNED host key; status revoked/unknown -> stop (the status is signed)
M -> H  auth      sig = Ed25519_member(tr_member)
H:      checks sig against the STORED member key
keys = HKDF(X25519(eM,eH), salt = tr, "session keys", 64)  -> member->host key || host->member key
H -> M  (sealed) ready { teamName, hostName }
```

`tr` covers the version, the status, the host key, the member key (zeros when unknown), `eM`, `nM`, `eH`, `nH`.

### 6.5 Messages (sealed)

| Direction | `t` | Content |
| --- | --- | --- |
| H -> M | `ready` | Team and host name. First sealed frame. |
| M -> H | `share` | A `TeamShare` (section 7). Sent when it changed (at most once a second) and as a keepalive every 20 s. |
| H -> M | `view` | The merged `TeamViewMsg`: the host, then every member with presence; the share of members that are online, **without the receiver's own share**. Sent when something changed (at most once a second) and every 20 s so the ages stay fresh. |
| both | `ping` / `pong` | Heartbeat when idle for 10 s. A connection silent for 35 s is dropped. |
| both | `bye` | `reason`: `leave` (member), `revoked`, `ended`, `stopped`, `replaced`, `rate-limited`, `protocol-error`, `timeout`. |

Nothing else exists. There is no message that carries a command, a prompt, an answer to a permission or a file.

### 6.6 Errors

Before the handshake completes a peer may answer one `error` with a code: `pairing-failed`, `pairing-locked` (for the
address that failed), `rate-limited`, `version-mismatch`, `team-full`, `save-failed`, `protocol-error`. `not-pairing` is
never sent: a host with no code open stays silent. The page explains each in the user's language. Reconnecting members back
off 1 s, 2 s, 4 s … up to 30 s with jitter, and 60 s after errors a stranger could forge (`version-mismatch`, `replaced`,
`rate-limited`, `protocol-error`, `host-key-changed`). They stop for good only for `revoked`, `unknown-member` (the host does
not know this device: team ended or recreated; signed) and `ended` (sealed).

## 7. What is shared

A member sends a **sanitized office snapshot** built by `buildTeamShare` from an allowlist. The result holds rooms
(`key`, `index`, optional `name`) and agents.

Always shared (needed to draw a person): the **display name** (the personalized one when set), the **device name** (a neutral
label such as `PC-3f9a` unless the person types one; never the host name, which often holds a real name), main or sub, status
(working, waiting, idle; finished or offline agents are not sent), how long ago the status began, the look (`f`/`m` and the
personalization look, harmless), which CLI (`claude` or `codex`) and the **kind** of the current activity (read, edit, bash…;
the page words it generically: "Reading", "Running a command"). Rooms are numbered "Project 1/2…" per member, in order of
arrival. Counts are derived by the receivers. Keys are `HMAC(device salt, kind:id)` truncated: stable on one device,
unlinkable to session ids or paths.

Never shared, whatever the settings: paths, the folder name behind a room alias, prompts, replies, commands and their
details, file names, tasks, permission requests and their summaries, messages, git state, accounts, models, session
ids, any text the person did not choose to share.

Opt-in per category, each **off by default**, in **Settings → Team mode → What I share** (and "Pause sharing" stops
everything at once without leaving the team):

| Category | Adds | Note |
| --- | --- | --- |
| Project names | The real room name instead of "Project N" | The alias when the person gave one, else the folder's last segment (either kind of separator); never the path or the original name behind an alias. |
| Activity in words | `activityText` (and its message) | May contain a file name or the head of a command. What the person typed (a prompt, a message) is never sent as words, even with this on. |
| Session titles | `title` | Usually the first prompt. |
| Branches | `branch` | |
| Tokens and cost | `tokens`, `costUSD` per agent | |

Visibility: whatever a member shares is visible to the host and to every other member. The host's own office is shared
under the host's own settings.

The look is rebuilt at the source with the validated fields only. Tests: `shared/src/team/sanitize.test.ts` runs 200 random offices whose every sensitive field holds a marker, for the
defaults, each category alone, and all on; no marker may appear except the one of the category enabled.

## 8. Where it appears

- **Settings → Team mode** opens the team dialog. *Host a team*: pick the network address, a port, your name and the
  team's name; it shows the address(es) and the pairing code (`ABCD-EFGH`, with a countdown, "New code"), the members
  (name, device, online or last seen, **Remove**), and **Stop listening** / **End team**. *Join a team*: address, code,
  your name. When in a team: the status, **What I share**, **Pause sharing**, **Leave the team**.
- The others appear as extra **rooms grouped by member** ("Ana · Project 1"), tinted with the member's color, in 2D and
  3D. The people are read-only: the drawer shows who and what kind of work, with the opt-in details if given, and offers
  no message, terminal, permission or hire.
- The sidebar has a **Team** filter (All, Mine, Team) once a team exists, with a member chip and presence.
- Presence: online, offline and last seen; the connection state of a member (connecting, connected, offline with the
  reason, rejected).

## 9. Residual risks (honest list)

- **No PAKE.** Node has no password-authenticated key exchange. An attacker who records a pairing (or sits in the middle of
  it, or runs a fake host the member is pointed at) can test code guesses offline against the proofs. Each guess costs one
  scrypt (about 80 ms and 32 MiB) and the code expires in ten minutes: a 40-bit code is out of reach inside that window for
  a typical attacker but not for a well-funded one. The damage is bounded: guessing the code in time lets the attacker pair
  as a member (and read the team's shared data) only if the real member did not consume the code first. Mitigations you
  control: pair with people you can see, regenerate the code if anything looks off, remove unknown members.
- **The code gives membership.** Whoever pairs first with a valid code is in; the host sees the name and device they
  announce but cannot verify them. Check the member list after pairing.
- **Traffic analysis.** The existence of the host and who connects to it are visible on the LAN.
- **The host sees everything the members share** and is trusted to relay it as is; members are trusted not to share
  junk (they cannot do more than the allowlist and the caps allow).
- **Timing.** Proof comparisons are constant time; the rest is not written to resist local timing attacks, which are
  outside the threat model (adversary C is a different user).
- **A LAN attacker with many source addresses can still keep a code unusable.** Per-address locks stop one address; sixty wrong proofs from several (spoofed or borrowed) addresses destroy the code, and the host makes a new one. It is a denial of the *pairing*, never of the team, and it costs the attacker the network position and many addresses. The same goes for the pool of unauthenticated connections: addresses that authenticated lately are protected and the busiest address is dropped first, but an attacker with many addresses can still churn it.
- **While a code is open a stranger learns that pairing exists** (a challenge with a public salt). With no code open the host answers nothing.
- **The fingerprint check is optional.** Comparing the host key out loud removes the code's offline-guessing risk; most people will not do it.
- **Listening on a shared address (100.64/10)** is possible after a confirmation; on carrier-grade NAT that exposes the (authenticated) listener to other subscribers.
- **The device name** is shared with the whole team; the person can type any label.
- **IPv6 is not supported.** Only IPv4 literals are accepted (a deliberate simplification: fewer address forms to validate).

## 10. Storage

`<stateDir>/team/` (directory `0700`, files `0600`, atomic writes):

- `host.json`: team id and name, host name and device, the host's Ed25519 key pair, the members (id, name, device, **public
  key**, created, last seen), the ids removed (last 64) and where the listener was left.
- `member.json`: team id and name, own id, name and device, own Ed25519 key pair, the **pinned** host public key, host name,
  host address and port.
- `settings.json`: the sharing preferences and the salt of the opaque ids.

A file this version cannot read is ignored (and kept). `AI_OFFICE_TEAM=0` makes the mode unavailable;
`AI_OFFICE_TEAM_LOOPBACK=1` lets a team use `127.0.0.1` (two instances on one computer: tests, demos).

## 11. Limits (constants in `server/src/team/limits.ts` and `shared/src/team/types.ts`)

Code: 8 characters, 10 minutes (monotonic), 5 wrong proofs lock it for an address, 60 in all destroy it. Members: 16. Per share:
40 agents, 16 rooms. Frames: 4 KB / 64 KB / 512 KB. First frame: 2 s. Handshake: 8 s. Pending connections: 32 (3 per address, 8
per /24, reserve 8 for recently authenticated addresses, oldest of the busiest address dropped when full). Pairing attempts: 10 per
minute per address, wrong proofs 2 per minute per address. Hellos: 30 per minute per address, failed session proofs: 8 per
minute per address. Messages: 40 per 10 s per connection. Heartbeat: 10 s / dead at 35 s.
Share: at most 1/s, keepalive 20 s. Reconnect: 1 s doubling to 30 s with jitter.

## 12. Test map

| Behavior | Test |
| --- | --- |
| Pairing success, wrong code, single use, expiry, regeneration, lockout, version mismatch | `server/src/team/handshake.test.ts`, `service.test.ts` |
| Man in the middle: fake host without the code, rewritten key in transit | `handshake.test.ts` |
| Replay, tampering, reordering, reflection, wrong session | `channel.test.ts`, `service.test.ts` (live listener) |
| Session: pinned host key, signed revocation, forged refusal, stolen `auth` | `handshake.test.ts` |
| Revoke, end team, leave, reconnect, restart | `service.test.ts` |
| Nothing but the allowed fields leaves; opt-in per category | `shared/src/team/sanitize.test.ts`, `service.test.ts`, `http/team-route.test.ts` |
| The team port speaks no HTTP; the main listener is still loopback-only; endpoints need the token | `service.test.ts`, `channel.test.ts`, `http/team-route.test.ts` |
| Two real servers over loopback | `http/team-route.test.ts` |
| Review fixes: revoke during a handshake, serialized file changes, idle strangers, forged host answers, per-address limits, silent host, shared address, fingerprints, device name | `hardening.test.ts`, `pending.test.ts`, `pairing.test.ts` |
| Hostile text and keys, message whitelist, prototype names | `shared/src/team/text.test.ts`, `sanitize.test.ts`, `validate.test.ts`, `shared/src/i18n/i18n.test.ts` |
| Framing edges (exact limit, trickled header, queue flood), key separation | `channel.test.ts` |
| Management endpoints refuse a non-local request | `http/team-route.test.ts` |
