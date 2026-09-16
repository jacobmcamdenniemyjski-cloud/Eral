# Earl Test 4 — Transactional Actions and Recovery

Keep the Earl body console captured to a file during this test. Do not merge
Batch 22 until every section passes in the real Minecraft server.

## 1. Action ownership

1. Tell Earl to follow you.
2. While moving, ask him to gather logs and then craft planks.
3. Trigger a safe hostile encounter during a build action.
4. Confirm the console never shows two physical actions running together.
5. Confirm combat interrupts the build, then the higher-level intention can be
   reconsidered or resumed after danger clears.

Useful diagnostic:

```powershell
node bin/mc.js actions
```

## 2. Transactional crafting and placement

1. Ask Earl to make a crafting table, chest, torches, glass panes, and a door.
2. Verify each reported craft changed inventory exactly as expected.
3. Place four interior torches and confirm no torch is consumed without a
   matching torch or wall torch appearing in the world.
4. Stand on one requested floor cell. Confirm Earl moves off his own target and
   reports a real player/entity obstruction instead of claiming success.

## 3. Verified gathering

1. Ask Earl to collect eight logs with open inventory space.
2. Repeat with a full inventory and a nearby chest.
3. Confirm the reported count matches inventory plus verified chest deposits.
4. Confirm a broken block whose drop was not recovered is reported as partial,
   not completed.

## 4. Persistent house plan and restart

1. Ask Earl to build a small Contract V1 house.
2. Record the persistent plan id with `node bin/mc.js build_plans active`.
3. Stop Earl midway through the build and restart him.
4. Confirm the plan is `paused`, retains the same origin and floor Y, and does
   not blindly repeat completed placements.
5. Resume only after inspecting the stored plan and world.
6. Finish inspection and physically traverse the door in both directions.

## 5. Restart-safe player request

1. Submit a build request and stop Earl after Hermes claims it.
2. Restart Earl and run `node bin/mc.js commands needs_review`.
3. Confirm the request is quarantined and does not execute automatically.
4. After checking the world, resume it with `node bin/mc.js recover ID`.

## 6. Farm creation

Prepare a level dirt or grass plot with water within four blocks of every cell,
a hoe, and enough seeds. Then ask Earl to create a small wheat farm.

Confirm he preserves water, clears only vegetation, tills every intended soil
cell, plants every field cell, and refuses solid or dry terrain instead of
claiming success.

## 7. Survival recovery

1. Lower Earl to critical health near a hostile and confirm gathering/building
   stops while he retreats and eats when food is available.
2. In a disposable test world, cause three deaths within ten minutes.
3. Confirm unsafe work and autonomy pause and combat remains suppressed during
   recovery instead of repeatedly returning to the same death site.

## 8. Final soak

Run normal Hermes gameplay, including one house improvement and one farm task,
then run:

```powershell
npm.cmd run soak -- --minutes 60 --interval 30
```

Save the body log, Hermes output, `data/tasks.json`, `data/bridge.json`,
`data/build-plans.json`, `data/survival-recovery.json`, and the soak report.
