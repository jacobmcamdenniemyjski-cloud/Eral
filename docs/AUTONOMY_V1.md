# Autonomous Life & Decision System V1

Batch 21 gives Earl a persistent, need-based intention controller. It does not
run a morning/farm/night schedule and it does not replace Hermes or Earl's
deterministic skills.

## Decision cycle

1. Preserve urgent survival and combat reflexes.
2. Resume a paused intention when it is still appropriate.
3. Observe health, hunger, time, inventory, saved home, nearby players, active
   tasks, and recent intention history.
4. Generate several candidate intentions from soft drives.
5. Score the candidates with need, preference, novelty, and a small tie-breaker.
6. Queue the selected intention for Hermes.
7. Hermes observes, plans, and acts through validated Earl skills.
8. Record the verified outcome and re-evaluate later.

The initial soft drives are survival, safety, food security, resource security,
home quality, curiosity, exploration, organization, social interaction, and
comfort. They influence choices; they are not scripts.

## Priority and interruption

Player requests have priority 100. Autonomous intentions have priority 10.
When combat or a player request interrupts an autonomous intention, Earl:

- marks the intention paused;
- pauses its queued request;
- cancels current deterministic body work safely;
- preserves the intention and interruption history; and
- re-queues that same intention after the interruption clears.

Hermes must re-observe the world on resume and must not blindly replay steps.

## Persistence

State is stored in `data/autonomy.json`. Active intentions recover as paused
after a restart. Completed and failed intentions become bounded history used to
discourage repetitive choices.

## Controls

```text
node bin/mc.js autonomy
node bin/mc.js autonomy_candidates
node bin/mc.js autonomy_on
node bin/mc.js autonomy_off
node bin/mc.js autonomy_tick
```

The combined Hermes launchers enable autonomy by default. Disable it for a
session before launching with:

```powershell
$env:EARL_AUTONOMY_ENABLED = "false"
```

Configuration:

| Variable | Default | Purpose |
|---|---:|---|
| `EARL_AUTONOMY_ENABLED` | launcher: `true` | Enable autonomous intentions |
| `EARL_AUTONOMY_INTERVAL_MS` | `30000` | State evaluation interval |
| `EARL_AUTONOMY_MIN_INTENT_INTERVAL_MS` | `120000` | Minimum spacing between new intentions |
| `EARL_AUTONOMY_FILE` | `data/autonomy.json` | Persistent state override |

## V1 boundaries

- Hermes still performs high-level planning.
- Earl still owns every physical Minecraft action and reflex.
- One intention produces one bounded useful outcome.
- Earl does not edit production code while playing.
- This version uses compact outcome history; richer episodic memory can be
  layered in after live testing.
