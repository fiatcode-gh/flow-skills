# The file mailbox protocol

How a dispatcher session and a worker session talk. Both sides follow this
protocol, and it is the same on every pair of harnesses, because its only
transport is the filesystem and the shipped tool that writes it — no daemon,
no socket, no live channel.

## Two layers: the floor and the upgrades

- **The floor** is this protocol: the mailbox files, the tool that writes
  them, `mailbox wait` for a blocked worker, and the user relaying between
  idle sessions. It completes a project on any pair of harnesses that can
  run the tool — and where one cannot, the answer is to stop and say so,
  never to improvise a channel by hand.
- **An upgrade** is an optional convenience one harness offers — live dispatch
  to a named session, a background watch that wakes an idle session when mail
  arrives. Upgrades remove a manual step; they never change the files or the
  rules — and each session evaluates its own harness's capabilities against
  its own tool list.

The boundary test: remove an upgrade and the work still finishes — the user
pokes a session by hand where it would have woken itself. Remove a floor piece
and the sessions can no longer exchange questions and answers at all.

Rejected outright, not deferred: any broker daemon, message queue, socket, or
other stateful intermediary. This method exists because sessions and channels
die and files survive; a broker reintroduces the failure this protocol was
designed against.

## The shipped tool

`scripts/mailbox` in this skill directory performs every mechanic of this
protocol: the sequence count, the clock stamp, the cursor trailer, the
append and its self-verification, the freshness test, and the self-stamping
bounded wait and watch. **Every write goes through it.** What follows is the
wire format the tool produces and the rules for reading that format — there
is **no by-hand write path**, because every improvised write has corrupted a
channel in the field. Cannot reach the tool? **Stop and say so** to your
user; never reconstruct the mechanics from memory.

The tool is **not on `PATH`**, so resolve its absolute path once, before your
first entry, and keep it for the session: it sits at `scripts/mailbox` inside
this skill's own directory, wherever your harness loads this skill from. Run
it once with no arguments to confirm the path — it prints its usage (and
exits 2, by design). Written `mailbox` below; substitute the path you
resolved.

    mailbox init   --home <mailbox home>
    mailbox append --as dispatcher|worker --dir <channel>
                   --disposed-through <N|none> [--file <path>]
    mailbox check  --as dispatcher|worker --dir <channel>
    mailbox wait   --as worker --dir <channel> [--timeout 570]
    mailbox watch  --as dispatcher --home <mailbox home> [--timeout 3600]
    mailbox watch  --as worker --dir <channel> [--timeout 3600]

Exit codes: 0 ok or mail delivered, 1 no new mail, 2 refused, 124 timeout.
`append` reads the body from standard input, or from `--file <path>` — use
the file form where your harness mangles multi-line standard input, as a
wrapped heredoc did in the field. `--timeout <seconds>` moves the window of
`wait` and `watch`. The tool never drops
`--foreground` from the timeout it runs, and refuses outright where the
environment's `timeout` lacks the flag: without it GNU timeout moves itself
into a new process group, a harness's group-directed kill reaches the
wrapper but not the watch, and an orphaned wait later stamps a delivery
nobody is reading.

It refuses rather than repairs, at exit 2: a missing cursor, an empty body,
a body line that is a level-two heading, a channel directory that does not
exist, a file whose numbering it cannot account for or whose headers it
cannot read, `wait` asked for by a dispatcher, and an environment whose
`timeout` lacks `--foreground`. It never touches the other side's
file, never edits an entry, never deletes. A refusal means nothing landed:
fix the input and retry, and never work around it by hand.

**The dispatcher states the tool's absolute path in the dispatch note**, in
entry 1, because the worker reads the prompt and the mailbox, not this
reference. A worker handed no path resolves its own.

## The mailbox

One directory per channel — one worker session's mailbox — under the
mailbox home the dispatching skill names (default `.flow/mailbox/` in the
dispatcher's checkout, per the `flow-artifacts` rule), with one single-writer
file per side. Nobody shares a write target — a
shared record has already produced a real two-writer collision once. When one
worker session carries several tasks they share its channel.

    <mailbox home>/<channel>/
      dispatcher.md   # dispatcher writes: dispatch note, answers, corrections
      worker.md       # worker writes: questions, pre-declared deviations,
                      # done and blocked notices
      REPORT.md       # worker writes once, at the end

Entry format, appended to the bottom of the writer's own file:

    ## <seq> — <dispatcher|worker> — <ISO timestamp>
    <body>

    disposed through <other side> entry <N>

The em dashes are load-bearing: the tool counts only headers of exactly that
shape, and it **refuses, on both sides**, a file holding a `## ` line it
cannot read — an older channel shape, a hand-written entry. A skipped header
duplicates a sequence number, and the other side then reports no new mail
over an entry nobody has read. The last line is the cursor trailer, written
`disposed through worker entry: none yet` before there is anything to
dispose of.

`mailbox init --home <mailbox home>` creates the home. The channel directory
under it is the dispatcher's to create, and creating a directory is not a
mailbox write — `mkdir` is sanctioned there and nowhere else. Every other
command refuses a channel directory that does not exist.

`mailbox append --as <side> --dir <channel> --disposed-through <N|none>`
writes exactly that shape: the next sequence number counted from your own
headers, the timestamp from the clock — **never hand-type** one, since
drifted stamps break the close-out fold that sorts by them — your body from
standard input or `--file`, and the cursor trailer. It appends, then
verifies its entry is the last header in the file.

Writing is the tool's job; reading is yours. These are the rules a reader
and an author still have to obey:

- "New mail" means: the other side's file holds an entry whose sequence
  number is higher than the "disposed through" cursor in your own last
  entry. Freshness is that **sequence comparison**, never a file-timestamp
  test — a timestamp can say "delivered" while an entry sits unread, and one
  did in the field. `mailbox check --as <side> --dir <channel>` asks exactly
  that question and prints what is unread: exit 0 new mail, exit 1 none.
- The cursor is yours to state on every entry — the other side's entry
  number you have now dealt with, or `none` before there is one. Only you
  know what you disposed of, so the tool demands it and never guesses.
- No body line may be a level-two heading at column 0 — not a quoted `## `
  header, and not a plain `## Findings` either. The format has no escape, so
  the reader cannot tell one from a real header: a quoted header corrupts the
  sequence count, and a prose heading makes every later append and check on
  that file refuse. Indent it by one space and it is prose again, or deepen
  it to `### `, which both sides read as body. The tool refuses such a body
  before anything lands.
- An entry, once appended, is never edited — **a correction is a new entry**.
  An in-place revision races every reader's stamp, and one lost that race in
  the field. So **only the tool writes** a mailbox file: never an anchored
  edit, never an editor, never a redirection of your own. Every entry ends
  with the same-shaped cursor trailer, so an edit anchor matches an earlier
  entry and inserts new mail mid-file — a dispatcher's entry 5 landed above
  its own entry 4 that way.
- A refusal means nothing landed: fix the input and retry. But a mailbox
  file that is already corrupt — duplicated headers, a stray delimiter — is
  a **stop**: say so to your user, and **do not repair it by hand**. The
  tool refuses to append into a file whose numbering it cannot account for,
  which is what keeps a corrupt channel from quietly becoming a lost entry.
- A restarted or compacted session re-reads both files and the dispatch prompt,
  and is fully re-bound. The record is the channel, so every correction is
  written down by construction.
- When the channel closes, the dispatching skill says where the two files
  are archived.

## Dispatch (dispatcher → worker)

User-brokered on every pair — the user creates the worker session, and that
gesture is what authorizes it. The dispatcher prepares everything, appends the
dispatch note as entry 1 of `dispatcher.md`, then stops and gives the user the
pointer prompt to paste as the worker's first message. Hand it over as plain
text between two `---` fence lines — never as a quoted or indented block,
which pollutes every line when the user copies it:

---
You are the worker session for `<channel>`. First command:
`cd <worktree> && pwd` — confirm the output. Read in full and execute:
`<dispatch prompt path>`. Converse with the dispatcher only through
`<channel directory>`: append entries to `worker.md`, read answers from
`dispatcher.md`. Your ordinary printed output reaches nobody.
---

**The worker's harness is the user's choice, made at each dispatch.** Any
harness can run the worker session — the artifacts the dispatcher prepares are
identical either way. So the dispatcher asks which harness runs this worker,
or offers the known options, and only then hands over the matching launch
gesture. A launch command found in the project's records is a history of past
choices, never policy: restating it as the only gesture silently pins the
project to one harness.

Two rules for that ask, both learned in the field:

- **Options carry plain harness names only.** The launch gesture goes in
  prose after the choice, never inside a structured question's option
  labels — command strings embedded in options have broken more than one
  asking interface.
- **No background mode is required.** Any ordinary interactive session the
  user opens is a valid worker, because the mailbox — not a live channel —
  carries the conversation. Detached or background session modes are
  upgrade territory; do not derive one from another harness's habits or
  from documentation about a harness's internal tools.

**The floor's launch gesture is this template — copy it, never construct
one.** Two substitutions only: the harness's plain session command (a single
word), and the channel name.

    # open a terminal, then:
    cd <worktree>
    <session command> -n <channel>
    # paste the pointer prompt as the first message

The `-n <channel>` names the session after the channel, so the user can find it
again — the current harnesses both spell the flag `-n`; drop it only when
the worker's harness has no session-name option. That is the one flag that
belongs in the gesture: no multiplexer, no detach flag, no prompt baked into
the command line. If the user wants that furniture, they will add it
themselves — every past attempt by a dispatcher to add it produced a wrong
gesture.

**Dispatch is not complete until your standing watch is running** (the watch
section below), wherever your harness can wake you — start it before handing
over the gesture, not after. And the handover itself states the watch's
status in one line — "my watch: running since <time>", or "no watch: this
harness cannot wake me; I check at boundaries" — so a missing watch is
visible to the user at the exact moment they read the gesture, instead of
being a claim they have to challenge. A dispatch handed over with neither a
watch nor that statement is the failure mode observed in the field.

## Mid-flight questions (worker ↔ dispatcher)

The worker appends the question to `worker.md`, then waits. One check
decides which wait: **is your standing watch verifiably alive** — the
process exists and is older than 30 seconds, one watch tick? Verify it now;
don't recall it.

- **Watch alive:** end your turn. The wake resumes you when the answer
  lands. Never add a foreground wait on top of a live watch — both wait on
  the same delivery, so the wait blocks the session for nothing; a worker
  ran both in the field, redundantly.
- **No watch, or dead or unverifiable:** `mailbox wait --as worker --dir
  <channel>`. A blocked worker has nothing else to do, so blocking in the
  foreground is correct behavior there, and it needs no background-task
  capability.

`wait` belongs to the worker. A dispatcher never waits: it checks between
tasks and lets its watch wake it, so a dispatcher that blocks is a
dispatcher that cannot answer.

Exit 0 means delivery: read `dispatcher.md` in full, dispose, and record the
new disposed-through cursor in your next entry. Exit 124 means the window
closed with nothing in it — wait again if the wait is still worth it, or
stop and tell your user:

> I asked the dispatcher a question in the mailbox and got no answer — please
> poke the dispatcher session.

The loop always closes through the human, with latency. It never deadlocks.

Keep the window under your harness's own shell-command cap, and verify that
cap once: if your first wait exits 124 far earlier than the timeout you
asked for, the harness's shell cap killed it, which is indistinguishable
from a quiet window except by elapsed time. Set the harness's own timeout
control explicitly to cover the window. The delivery marker survives either
way, so an early kill costs a cycle, never mail.

The dispatcher answers by appending to `dispatcher.md`. While a build is out,
the dispatcher checks the mailbox **between tasks and at every turn
start** — `mailbox check` is an instant read, not a wait — so an actively
working dispatcher answers within one task with no waiting machinery. The
worker mirrors this on its side of the floor: check `dispatcher.md` **at
every task boundary** — between plan tasks, before each commit — so a
dispatcher correction is picked up within one task even with no watch
running.

## Completion (worker → dispatcher)

The worker writes `REPORT.md`, appends a done notice to `worker.md`,
and stops. The dispatcher learns of it from its interleaved checks, from an
idle-wake upgrade where one exists, or from the user saying so. The report is
on disk unconditionally, so a wave can finish while nobody is listening and
lose nothing.

## The standing mailbox watch (when your harness can wake you)

An upgrade with a floor-wide definition, because more than one harness can
run it — and **both roles run it**, which is what makes the mailbox a
two-way event channel rather than a worker-initiated one. If your harness
offers a way to run a background task that re-invokes the session when the
task exits — an agent-launched background command, by whatever name — start
the watch for your role and restart it per the rules below.

**The dispatcher's watch** — started as part of every dispatch, not as an
option to remember later. Launch it as your harness's background task:

    mailbox watch --as dispatcher --home <mailbox home>

`mailbox init` seeds `.dispatcher-mail-delivered`, the dispatcher's own
marker, so a first watch does not fire on your own freshly created files; it
never touches a marker that already exists, which could swallow another
channel's unread wake. A worker's marker is deliberately not seeded — its
first watch or wait should fire at once on mail already waiting — and where
a marker is missing the tool treats it as the epoch instead of erroring, a
crash net that once cost a whole wave.

The tool **stamps at fire time**, before you wake, and nothing else ever
stamps a delivery marker — **never stamp one by hand**. That ordering is
load-bearing: a message that lands while you are answering is newer than the
fire-time stamp, so the restarted watch fires again immediately instead of
sleeping on it. A quiet hour moves nothing.

One watch covers every open channel. When it exits — with 0 or with 124 —
**restart it first, before reading anything**: everything after the restart
has variable length, and a restart deferred behind processing is a restart
that lapses (it did, in the field). Then, on a 0, read **every** open
channel's `worker.md` — not only the one you think moved — and answer
everything unanswered. The restarted watch is armed against the fire-time
stamp, so it never re-fires for the mail you are already reading, and mail
landing while you answer wakes you again. A duplicate wake re-reads mail you
have seen; entries carry sequence numbers, so that costs nothing. Exit 124
is a quiet hour, normal for a long build. Stop restarting only when no channel
is open.

**The worker's watch** — started as the worker's first action after
`cd <worktree> && pwd`, **before reading the spec, before recon, before any
work**: a post-dispatch correction — a spec update, a halt — must be able to
land from minute zero. The worker meets this section as a verbatim block
inside its dispatch prompt (a dispatching skill may
restate it as a prompt-authoring rule), and the opening capability condition **is the
worker's to evaluate, against its own tool list** — a dispatcher resolving it
at authoring time is guessing about a harness it does not run, and one such
guess parked a capable worker on the floor for a whole channel. It shares
the delivery marker its wait uses:

    mailbox watch --as worker --dir <channel>

On a wake, restart the watch first, then read `dispatcher.md` in full and
dispose of the new entry: if it changes the task you are on, stop and adjust; if
it locks or corrects a decision, follow it from here on; otherwise
acknowledge it in your next `worker.md` entry and keep building. While this
watch is standing and verified alive, a blocked worker ends its turn instead
of waiting in the foreground — the wake replaces the wait, and `mailbox
wait` remains the floor for a watchless or dead-watch session. The branch is
stated at the wait itself, in the mid-flight questions section.

**A claimed watch carries a liveness duty.** Harnesses have dropped a
completion wake and reported a dead watch as running, both in the field —
so where a watch is your promptness story, every task-boundary check also
verifies the watch process is genuinely alive (older than one watch tick,
30 seconds).
Dead or unverifiable means you are on the floor: say so in your next entry
and rely on boundary checks and `mailbox wait` until a relaunch proves
stable.

**Closing a watch means stop restarting, never trusting a kill.** When no
channel is open (dispatcher) or the dispatcher closes the mailbox (worker),
stop restarting and let the final instance expire on its own timeout — its
terminal wake into a closed channel costs nothing, since the sequence check
finds no mail. Do not depend on killing the running instance. Where a kill
is attempted anyway, "killed" may be claimed only from the kill's
confirmed result; an unconfirmed kill is reported as "left to expire" —
a worker wrote "killed" in the same breath as the kill call whose result
then said otherwise, in the field.

**The delivery markers serve the watch and the wait, nothing else.**
`.dispatcher-mail-delivered` and `.worker-mail-delivered` record that a fire
happened — that mail was delivered, not that it was read. No boundary check,
no freshness question, no done-decision may consult them: a worker nearly
closed a channel with the final entry unread because a marker then named
`-last-read` answered a question it cannot answer. Unread-or-not is always
the sequence comparison against your own disposed-through cursor.

Without a background capability on either side, the floor stands on its own:
boundary checks, the blocked wait, and the user's poke.

## What the channel does not carry

No authorization. Not for pushes, pull requests, reviewer requests, merges,
or anything sent to a stakeholder. Those need the user's explicit approval,
per round, and nothing in the mailbox can grant them.
