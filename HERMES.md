# Earl Hermes Runtime

This repository is Earl's deterministic Minecraft body. Hermes is the
high-level brain. Never start a second Mineflayer bot or copy HermesCraft's
`bot/server.js`; all Minecraft actions must go through this repository's
validated body API with:

```text
node bin/mc.js ...
```

## Session startup

1. Run `node bin/mc.js health`.
2. Run `node bin/mc.js skills` once if the capability surface is unfamiliar.
3. Run `node bin/mc.js commands`.
4. Handle pending requests oldest first.
5. When no request is pending, run `node bin/mc.js listen` as a background
   terminal process with completion notification enabled, then end the turn.
6. When that listener reports a command, process it and start a fresh listener
   after the queue is empty.

The idle listener blocks locally and wakes only for a Minecraft request. Do not
poll with repeated model turns.

## Request lifecycle

For every queued request:

1. Claim it with `node bin/mc.js claim ID`.
2. Inspect only the state needed with `status`, `scene`, `inventory`,
   `recipes`, `marks`, `deaths`, or another read operation.
3. Perform actions through friendly `mc.js` commands or
   `node bin/mc.js exec SKILL JSON`.
4. Use background actions for long movement, collection, smelting, or recovery;
   inspect `node bin/mc.js task` before starting another long action.
5. Report a short verified result in Minecraft with
   `node bin/mc.js chat MESSAGE`.
6. Mark the request with `complete ID RESULT` or `fail ID REASON`.

Never claim success unless the structured body result says the skill succeeded.
After one reasonable correction, report the actual blocker instead of looping.

## Ownership boundary

Earl's body is authoritative for recipes, crafting plans, resource names,
pathfinding, door handling, combat timing, farming, smelting, containers,
building primitives, survival reflexes, and cancellation. Do not simulate these
mechanics in prose or recreate them in shell scripts. Ask the body and call its
skill.

Direct in-game commands and automatic survival/combat reflexes intentionally
bypass Hermes. They must remain fast and work when the model provider is
offline. Player requests outrank autonomous goals.

## Common commands

```text
node bin/mc.js status
node bin/mc.js scene 16
node bin/mc.js inventory
node bin/mc.js recipes wooden_pickaxe
node bin/mc.js follow jacob48317
node bin/mc.js bg_collect oak_log 8
node bin/mc.js craft wooden_pickaxe 1
node bin/mc.js farm_all wheat
node bin/mc.js smelt raw_iron 4 coal
node bin/mc.js fight zombie
node bin/mc.js flee 16
node bin/mc.js pickup
node bin/mc.js sleep
node bin/mc.js mark home
node bin/mc.js go_mark home
node bin/mc.js deathpoint
```

Use `node bin/mc.js skills` for the complete JSON schemas.

## Memory and learning

Use Hermes memory for stable facts about Jacob, relationships, preferences,
promises, and compact lessons from failures. Use Hermes skills for procedures
that worked repeatedly.

A learned Minecraft procedure may contain only declarative sequences of
`node bin/mc.js` commands plus checks of their structured results. Never
generate arbitrary JavaScript, modify Earl's production source while playing,
or store invented results. Store coordinates through named marks rather than
inside learned procedures.

Keep `skills.write_approval: true`. Review staged changes before they affect
future sessions.

## Development safety

Normal play must not edit this repository. Source changes require the usual
branch, tests, review, and merge workflow. The body API defaults to loopback.
A non-loopback bind requires `EARL_API_TOKEN`; never expose an unauthenticated
control endpoint.
