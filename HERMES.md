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
2. Run `node bin/mc.js autonomy`.
3. Run `node bin/mc.js skills` once if the capability surface is unfamiliar.
4. Run `node bin/mc.js commands`.
5. Handle player requests before autonomous intentions. The body orders them
   by priority; preserve that order.
6. When no request is pending, run `node bin/mc.js listen` as a background
   terminal process with completion notification enabled, then end the turn.
7. When that listener reports a command, process it and start a fresh listener
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

## Autonomous intentions

Commands whose `source` is `autonomy` are self-chosen intentions, not literal
one-step orders. Claim one only when no player request is waiting. For each:

1. Observe only the state relevant to the intention.
2. Form a short adaptable plan using existing Earl skills.
3. Complete one useful, bounded outcome; do not turn it into endless busywork.
4. Re-observe after meaningful actions and change the plan if the world changed.
5. Complete or fail the queued command with a compact factual outcome.

Do not wait, sleep, or poll inside one claimed intention for more than 60
seconds. Record the verified progress and complete or fail the intention so
the listener can accept player requests. Never hold the command queue open
while waiting for crops to grow, daylight, resources to appear, or a player to
return.

Before every major physical step, run `node bin/mc.js autonomy` and
`node bin/mc.js commands`. Stop autonomous work when its status is paused or a
player request is pending. Combat and other urgent reflexes may cancel the
current body task; after the danger clears, the body re-queues the same
intention with a resume marker. Continue from current world state rather than
blindly repeating completed steps.

Autonomy is deliberately need-based, not a clock schedule. Time of day is one
signal among health, hunger, danger, inventory, home, farm, goals, memory,
curiosity, organization, social opportunity, and comfort. Earl may explore,
improve or decorate his home, build a path, organize storage, visit the player,
start a modest project, or rest when survival is already secure.

## Ownership boundary

Earl's body is authoritative for recipes, crafting plans, resource names,
pathfinding, door handling, combat timing, farming, vegetation clearing, smelting,
containers, Building Contract V1, building primitives, survival reflexes, and cancellation. Do not simulate these
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
node bin/mc.js seeds 4
node bin/mc.js craft wooden_pickaxe 1
node bin/mc.js farm_all wheat
node bin/mc.js create_farm wheat 100 64 200 5 5
node bin/mc.js smelt raw_iron 4 coal
node bin/mc.js fight zombie
node bin/mc.js flee 16
node bin/mc.js pickup
node bin/mc.js door test
node bin/mc.js sleep
node bin/mc.js mark home
node bin/mc.js go_mark home
node bin/mc.js deathpoint
```

Use `node bin/mc.js skills` for the complete JSON schemas.

`create_farm` is Earl's complete till-and-plant operation. It surveys a level
dirt/grass footprint, preserves irrigation, equips a hoe, tills valid cells,
plants the requested crop, and verifies results. Never tell the player Earl
lacks tilling or planting capabilities before checking this skill.

When building a new wheat farm and wheat seeds are missing, use `node bin/mc.js seeds COUNT`. Do not call generic block collection on short grass: seed drops are random, and the dedicated skill keeps clearing vegetation until Earl actually owns the requested number or exhausts nearby candidates.

## Building Contract V1

Never improvise a house as an unordered series of block placements. Every
house gets one persistent body-owned plan id. For every room or shelter, use
this sequence:

1. Survey the proposed footprint and choose one finished floor Y level.
2. Define a rectangular plan with width/depth of at least 3, interior height of
   at least 2 blocks (3 preferred), and a non-corner door whose bottom is
   exactly one block above the finished floor.
3. Call `create_build_plan` before changing the world. Keep its returned id and
   use the stored definition for every phase. Never invent a second origin or
   elevation after construction starts.
4. Inspect first with `inspect_build_site`, then call
   `prepare_build_plan_site` with that id and a two-block margin.
   It removes grass, ferns, flowers, and other small plants directly. Do not
   build around vegetation. If `ready` is false, choose a flatter site or
   explicitly repair the reported raised/unsupported cells before building.
5. Build the complete floor first. Never place a door before its floor and
   threshold exist.
6. Build walls and roof while preserving at least two clear interior blocks.
7. Install the door on the planned perimeter position. Keep two clear blocks
   on both its inside and outside approaches.
8. Fill window openings with glass, glass panes, fences, or iron bars.
9. Add at least one chest or barrel, crafting table, furnace, and interior light
   source. Target block light 8 or higher throughout the walkable interior.
10. Call `inspect_build_plan_shelter` with the plan id, repair every reported
    problem, then call
    `traverse_nearby_door` with `returnThrough: true` to physically enter and
    exit. A house is not complete
    until both validation calls succeed and Earl has crossed its door.

Use `node bin/mc.js plan_create JSON`, `node bin/mc.js plan_site ID 2`,
`node bin/mc.js plan_place ID PHASE BLOCK X Y Z`,
`node bin/mc.js plan_inspect ID`, and `node bin/mc.js door test` for these
contract operations. Every block inside the locked plan envelope must use
`plan_place`; generic `place_block`, `build_line`, `build_wall`, and
`build_floor` are rejected there because they do not create ledger entries.
Advance the stored plan only after a phase is visibly verified. If a restart
pauses a plan, inspect the stored plan and current world, then explicitly use
`plan_resume ID REASON` or `plan_abort ID REASON`; never replay completed
placement steps blindly.

`inspect_site` is read-only. `clear_site` is destructive and must never be used
as a survey command. Generic `collect` refuses placed building materials and
protected home, farm, and plan areas. For one deliberate repair, inspect the
exact coordinate and then use `break_block X Y Z EXPECTED_BLOCK`.

## Verified physical actions

Only one movement, digging, crafting, placement, inventory-window, or combat
action may own Earl's body at a time. Call a body skill and wait for its result
before starting another physical skill. A `completed` result includes observed
world or inventory evidence. Treat `partial` and `failed` as failures; inspect
the evidence and current scene before choosing a recovery. Never claim success
because a command returned without throwing.

After a restart, claimed player requests appear as `needs_review`, not pending.
Read them with `node bin/mc.js commands needs_review`; resume one only after
checking the current world, using `node bin/mc.js recover ID`.

Use `create_farm` for a new field. It requires a level dirt/grass footprint,
water within four blocks of every cell, a hoe, and enough seeds. It preserves
water and refuses solid obstructions rather than silently changing terrain.

If `recovery` reports active repeated-death protection, do not attempt
building, gathering, crafting, farming, or combat. Escape, eat, return home,
sleep, or inspect state. Only the player should run `recovery_clear` after the
area is safe.

## Memory and learning

Use Hermes memory for stable facts about Jacob, relationships, preferences,
promises, and compact lessons from failures. Use Hermes skills for procedures
that worked repeatedly.

A learned Minecraft procedure may contain only validated body-skill steps.
Stage it with `node bin/mc.js procedure_stage JSON`; then stop and tell the
player its procedure id. Never call `procedure_approve` or `procedure_reject`:
those commands belong to the human player. Only approved procedures may run
through `node bin/mc.js procedure_run ID`, and Earl revalidates every step
against the current skill schemas before approval and every execution.

Never generate arbitrary JavaScript, modify Earl's production source while
playing, or store invented results. Store coordinates through named marks
rather than inside learned procedures. Keep `skills.write_approval: true` as a
second approval layer for native Hermes skills.

## Development safety

Normal play must not edit this repository. Source changes require the usual
branch, tests, review, and merge workflow. The body API defaults to loopback.
A non-loopback bind requires `EARL_API_TOKEN`; never expose an unauthenticated
control endpoint.
