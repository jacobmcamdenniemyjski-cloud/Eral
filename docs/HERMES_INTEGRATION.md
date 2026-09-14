# Hermes Agent integration

Earl can run with either its existing Ollama loop, no model, or Hermes Agent as
the high-level brain. Hermes does not replace Earl's Mineflayer body. It calls
the same validated skills used by direct Minecraft commands.

## Architecture

```text
Minecraft chat
  -> Earl command router
     -> direct command/reflex (immediate), or
     -> Hermes request queue
        -> Hermes Agent
           -> node bin/mc.js
              -> localhost body API
                 -> structured Earl skill
                    -> Mineflayer
```

Only one Mineflayer bot connects to Minecraft.

## Prerequisites

- Node.js 18 or newer
- Earl dependencies installed with `npm install`
- Hermes Agent installed and configured
- A Hermes-supported model provider, such as DeepSeek
- A running Minecraft Java server

Install Hermes using its official instructions, then run:

```text
hermes setup
hermes model
```

Choose the provider and model interactively. DeepSeek is supported directly, so
the API key belongs in Hermes configuration, not this repository and not Git.
The launchers normally use the provider/model selected by `hermes model`.

For safer procedural learning, enable review before Hermes changes a learned
skill:

```text
hermes config set skills.write_approval true
```

You can also gate memory writes:

```text
hermes config set memory.write_approval true
```

## First body-only test

Start Earl in Hermes mode without launching the agent:

PowerShell:

```powershell
$env:EARL_BRAIN = "hermes"
npm start
```

Bash:

```bash
EARL_BRAIN=hermes npm start
```

A successful startup includes:

```text
Earl body API listening on http://127.0.0.1:3001.
Earl connected and spawned using hermes brain mode.
```

In a second terminal:

```text
node bin/mc.js health
node bin/mc.js status
node bin/mc.js skills
node bin/mc.js scene 16
```

Stop the body before using the combined launcher.

## Start Earl and Hermes

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-hermes.ps1
```

Linux, macOS, or WSL:

```bash
bash scripts/start-hermes.sh
```

The launcher:

1. starts Earl if its API is not already running;
2. temporarily installs Earl's personality as the Hermes SOUL;
3. loads this repository's `HERMES.md` control contract;
4. starts an interactive Hermes session;
5. restores the previous Hermes SOUL on exit.

The initial Hermes turn checks Earl and arms `node bin/mc.js listen` as a
background listener. That listener blocks locally until an in-game request is
queued, avoiding repeated paid model calls while nobody is speaking.

To force a provider/model for one launch:

PowerShell:

```powershell
$env:EARL_HERMES_PROVIDER = "deepseek"
$env:EARL_HERMES_MODEL = "<model selected in Hermes>"
powershell -ExecutionPolicy Bypass -File .\scripts\start-hermes.ps1
```

Bash:

```bash
EARL_HERMES_PROVIDER=deepseek \
EARL_HERMES_MODEL="<model selected in Hermes>" \
bash scripts/start-hermes.sh
```

Omit both variables to use the choice saved by `hermes model`.

## Minecraft acceptance test

Run these in order:

1. `earl status` — must remain immediate and deterministic.
2. `earl follow me`, then `earl stop` — direct movement and cancellation.
3. `earl ask tell me what you can see` — Hermes should claim the queued
   request, call scene/status, answer briefly, and complete it.
4. `earl ask gather four oak logs` — Hermes should use a background collect
   action and report the real result.
5. `earl ask make a wooden pickaxe` — recipe decisions must come from Earl's
   crafting planner.
6. `earl ask harvest all mature wheat` — Hermes should inspect farm status
   and invoke the farm-all skill.
7. `earl ask remember this place as home`, then
   `earl ask return home`.
8. While a long action runs, issue `earl stop`.
9. Confirm automatic eating, armor, and defensive combat still work without
   Hermes issuing duplicate reflex commands.

Use these diagnostics in the Hermes terminal:

```text
node bin/mc.js commands
node bin/mc.js task
node bin/mc.js scene 16
node bin/mc.js deaths
```

Do not merge the integration branch until the automated suite and this gameplay
check both pass.

## Brain modes

| Setting | Behavior |
|---|---|
| `EARL_BRAIN=hermes` | Queue `earl ask` and unknown Earl requests for Hermes; enable body API. |
| `EARL_BRAIN=ollama` | Use the existing local Ollama agent. |
| `EARL_BRAIN=none` | Direct commands/reflexes only; no language model. |

## API and security

The body API listens on `127.0.0.1:3001` by default.

| Variable | Default | Purpose |
|---|---|---|
| `EARL_API_HOST` | `127.0.0.1` | API bind address |
| `EARL_API_PORT` | `3001` | API port |
| `EARL_API_URL` | derived | URL used by `bin/mc.js` |
| `EARL_API_TOKEN` | empty locally | Bearer token |
| `EARL_DATA_DIR` | `./data` | Durable bridge/task/procedure state |
| `EARL_BRIDGE_FILE` | under data dir | Optional queue-state override |
| `EARL_TASKS_FILE` | under data dir | Optional task-history override |
| `EARL_PROCEDURES_FILE` | under data dir | Optional procedure-store override |
| `EARL_MC_HOST` | `localhost` | Minecraft host |
| `EARL_MC_PORT` | `25565` | Minecraft port |
| `EARL_MC_USERNAME` | `earl` | Bot username |
| `EARL_MC_AUTH` | `offline` | Mineflayer authentication mode |
| `EARL_MC_VERSION` | `1.21.11` | Minecraft protocol version |

A non-loopback API bind is rejected unless `EARL_API_TOKEN` is set. The CLI
sends that token automatically. Keep the endpoint private; it can move, build,
fight, and use Earl's inventory.

The launchers use Hermes YOLO mode for unattended Minecraft tool calls. Set
`EARL_HERMES_YOLO=false` to retain terminal approval prompts.

## Learning boundary

Hermes memory may retain player preferences and important events. Learned
procedures may contain declarative `node bin/mc.js` sequences only. The agent
must not generate JavaScript, modify Earl's source while playing, or bypass the
skill registry. Named locations remain Earl-owned data.

Stage and review Earl body procedures with:

```text
node bin/mc.js procedure_stage "{\"name\":\"gather_wood\",\"steps\":[{\"skill\":\"gather_block\",\"input\":{\"block\":\"oak_log\",\"amount\":4}}]}"
node bin/mc.js procedures pending
node bin/mc.js procedure_approve 1
node bin/mc.js procedure_run 1
node bin/mc.js procedure_reject 2 reason
```

Hermes may stage a procedure, but only the player may approve or reject it.
Earl stores no code: each step must name a registered skill and pass its current
JSON schema at staging, approval, and execution.

## Restart recovery

Player messages, queued requests, task history, and learned procedures persist
under `data/`. On restart, a request that Hermes had claimed returns to
`pending`. An action that was `starting` or `running` is recorded as
`interrupted`; Earl deliberately does not replay physical actions because the
Minecraft world may have changed while it was offline.

## Survival soak test

After the normal gameplay acceptance test, leave Minecraft and Earl running and
start a monitored survival test in another terminal:

```text
npm run soak -- --minutes 60 --interval 30
```

The runner checks health, status, inventory, current task, and death history. It
writes `data/survival-soak-latest.json` and fails if the API disconnects, a
sample errors, or Earl records a new death. Change the duration and sample
interval as needed; for example, use `--minutes 240 --interval 60` for a
four-hour test.
