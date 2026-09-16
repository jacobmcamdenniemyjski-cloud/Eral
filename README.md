# Earl

Earl is a self-hosted autonomous Minecraft NPC built with Mineflayer and local AI.

The goal is to create a persistent Minecraft companion that can survive, gather resources, craft, farm, fight, build, explore, remember players, and make high-level decisions autonomously.

## Autonomous Life & Decision System

Batch 21 adds a persistent need-based intention controller. Earl weighs
survival, safety, food and resource security, home quality, curiosity,
exploration, organization, social interaction, and comfort instead of following
a fixed time-of-day routine. It chooses a high-level intention, lets Hermes plan
through existing validated skills, records the outcome, and later re-evaluates.

Player requests and urgent combat reflexes override autonomous work. The current
intention is paused and preserved, then resumed from current world state after
the interruption clears. See [docs/AUTONOMY_V1.md](docs/AUTONOMY_V1.md).

```text
node bin/mc.js autonomy
node bin/mc.js autonomy_candidates
node bin/mc.js autonomy_on
node bin/mc.js autonomy_off
```

## Current status

- Minecraft Java server running
- Mineflayer installed
- Earl connects successfully
- Players can interact with Earl through chat

## Architecture

AI / Goals → Deterministic Skills → Mineflayer → Minecraft

## Hermes Agent / HermesCraft compatibility

Earl can now use Hermes Agent as its high-level brain while keeping Earl's
tested commands, combat/survival reflexes, crafting, farming, smelting,
building, and pathfinding as the single deterministic Mineflayer body. The
integration provides a localhost body API, cross-platform `node bin/mc.js`
control CLI, queued Minecraft chat, background task cancellation, fair-play
scene summaries, death recovery, and an idle command listener.

Hermes supplies higher-level planning, persistent memory, personality, and
reviewable procedural learning. It does not run a second bot or generate
Minecraft JavaScript. See [docs/HERMES_INTEGRATION.md](docs/HERMES_INTEGRATION.md)
for DeepSeek/Hermes setup and the complete acceptance test.

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-hermes.ps1
```

Linux/macOS/WSL:

```bash
bash scripts/start-hermes.sh
```

## Commands

- `earl follow me` — Follows you, opens wooden/copper doors and fence gates, and will not dig through walls.
- `earl stop` — Safely cancels the active queue, movement, gathering, or combat.
- `earl goto <x> <y> <z>` — Travels within two blocks of the coordinates.
- `earl mark home` — Saves Earl's current position as home.
- `earl mark <location>` — Saves a named location.
- `earl locations` — Lists saved location names and prints coordinates in the console.
- `earl go home` / `earl go <location>` — Travels to a saved location.
- `earl forget <location>` — Removes a saved location.
- `earl sleep` — Finds a bed within 32 blocks, approaches it, and sleeps when Minecraft allows.
- `earl look at me` — Looks toward you.
- `earl find <block>` — Finds the nearest specified block.
- `earl scan` — Lists nearby entities in the console.
- `earl status` — Shows health, food, position, and status in the console.
- `earl inventory` — Lists inventory in the console.
- `earl gather <block> <amount>` — Mines and collects up to 64 blocks.
- `earl craft <item> <amount>` — Crafts items, using a nearby table when required.
- `earl make <item> <amount>` — Crafts required intermediate items, then the requested item.
- `earl farm status [crop]` — Counts mature crops, growing crops, and empty farmland nearby.
- `earl farm <crop> <amount>` — Harvests mature crops and immediately replants them.
- `earl harvest <crop> <amount>` — Alias for `earl farm`.
- `earl collect <amount> <crop>` — Harvests and replants the requested number of mature crops.
- `earl collect all <crop>` — Inspects the farm, then harvests and replants every mature requested crop.
- `earl smelt <item> <amount> [with <fuel>]` — Adds to a compatible furnace load, fuels it, and collects the finished items.
- `earl furnace status` — Reports nearby furnace input, fuel, output, and progress.
- `earl furnace collect` — Retrieves all finished output from the nearby furnace.
- `earl store <item> <amount>` — Stores items in a nearby container.
- `earl take <item> <amount>` — Withdraws items from a nearby container.
- `earl equip <item>` — Equips or holds an item.
- `earl attack <hostile>` — Attacks the nearest specified hostile mob.
- `earl combat <mode>` — Sets automatic combat to `passive`, `defensive`, `guard`, or `aggressive`.
- `earl combat status` — Shows the automatic combat mode and protected player.
- `earl task` — Shows Earl's current task in the console.
- `earl place <block> [x y z]` — Places a block, optionally at exact coordinates.
- `earl build line <block> <x> <y> <z> <direction> <length>` — Builds a line.
- `earl build wall <block> <x> <y> <z> <direction> <width> <height>` — Builds a wall.
- `earl build floor <block> <x> <y> <z> <width> <depth>` — Builds a floor.
- `earl skills` — Lists Earl's structured skills in the console.
- `earl llm status` — Checks Ollama and confirms the configured model is installed.
- `earl ask <request>` — Lets the local model plan and execute registered skills.

## Structured skill registry

Earl's chat commands and AI planners share the same 55 deterministic
skills. Each skill has a stable name, description, JSON input schema, timeout,
and safety category. Inputs are validated with Ajv before Minecraft code runs,
and every execution returns a structured success or error result.

The registry is available at `bot.earl.skillRegistry`. A future model provider
can read `getToolDefinitions()` and request a skill by name; the model will not
generate or execute arbitrary JavaScript. Existing Mineflayer capabilities
remain the implementation underneath the registry.

Natural-language structures follow [Building Contract V1](docs/BUILDING_CONTRACT_V1.md):
validate the plan, clear vegetation across the whole site, build the floor
before the door, inspect the finished utilities/light/entrance, and physically
walk through the door before declaring the build complete.

Example internal call:

```js
const result = await bot.earl.skillRegistry.execute(
  'gather_block',
  { block: 'oak_log', amount: 8 },
  { cancelActiveWork }
)
```

Batch 10 adds the safe skill boundary only. It does not send chat to an LLM or
require an AI API key yet.

## Local Ollama setup

Batch 11 uses Ollama's official JavaScript client and tool-calling loop. The
default model is `qwen3:4b-instruct`, a 2.5 GB non-thinking model with tool support.

Install the model from PowerShell:

```powershell
ollama pull qwen3:4b-instruct
ollama list
```

Ollama normally runs its local API automatically at
`http://127.0.0.1:11434`. Start Earl and verify the connection:

```cmd
npm install
npm start
```

```text
earl llm status
earl ask check your health and tell me how you are doing
earl ask follow me
earl ask make one wooden pickaxe
```

Unambiguous `earl ask` actions such as `follow me`, `gather two dirt`,
`make a wooden pickaxe`, and `go to 10 64 20` take a deterministic fast path
through the same validated skill registry instead of waiting for the model.
More complex `earl ask` requests still use Ollama. Existing deterministic
commands continue to work when Ollama is offline. The model can request only
the schema-validated skills in Earl's registry and cannot execute JavaScript.
Earl sends only the tools relevant to each request; ordinary conversation sends
no tool schemas and uses a separate minimal prompt with a 2048-token context.
Minecraft actions retain the 4096-token context and tool safety rules. These
defaults reduce CPU and memory load without removing Earl's deterministic
skills. Casual replies are also capped at 128 generated tokens to stop runaway
monologues. Console logs show the mode, tools selected, and model-round timing.

The LLM interface keeps Minecraft mechanics deterministic: `make_item` owns
recipe planning, storage skills locate containers without entity scans, generic
resource words such as `logs` resolve to real block/item variants, identical
tool calls in one round run only once, and verbose reasoning-style output is
blocked before it reaches game chat.

## Home, saved locations, and sleeping

Named locations are stored in `data/locations.json` and survive Earl restarts.
Each location includes its Minecraft dimension, so Earl refuses to path toward
overworld coordinates while he is in another dimension. The runtime data folder
is ignored by Git.

```text
earl mark home
earl mark village
earl locations
earl go home
earl go village
earl forget village
earl sleep
earl ask remember this place as home
earl ask return home
earl ask go to bed
```

Sleeping uses Mineflayer's built-in bed detection and sleep API. Earl searches
within 32 blocks and reports normal Minecraft restrictions such as daytime, an
occupied bed, monsters nearby, or excessive distance.

## Furnace management

Earl can inspect a nearby furnace, collect existing output, add more of the same
input to an occupied furnace, and reuse compatible fuel already in its fuel
slot. A different input is rejected instead of mixing furnace recipes, and the
64-item input-slot limit is enforced.

```text
earl furnace status
earl furnace collect
earl smelt raw iron 3
earl smelt raw iron 3 with coal
earl ask collect the furnace output
```

## Farming

Earl farms existing fields with Mineflayer's official block APIs plus the
already-installed pathfinder and collect-block systems. Supported crops are
`wheat`, `carrots`, `potatoes`, and `beetroots`. Only fully mature crops are
harvested, and Earl preserves the correct seed item so each harvested block can
be replanted immediately. `all` farms every supported mature crop nearby.

```text
earl farm status
earl farm status wheat
earl farm wheat 8
earl harvest carrots 4
earl farm all 16
earl collect 3 wheat
earl collect all wheat
earl ask harvest four wheat
earl ask collect all wheat
```

This batch operates existing farmland. Creating, tilling, irrigating, and
expanding a new field remain separate future skills.

To try a different installed model for one PowerShell session:

```powershell
$env:EARL_OLLAMA_MODEL="qwen3:8b"
$env:EARL_OLLAMA_NUM_CTX="4096"
npm start
```

The optional `EARL_OLLAMA_HOST` variable can point Earl at another Ollama
server. Larger context settings use more memory.

### Ollama thinking and debug mode

Thinking is model-aware. Earl defaults to the non-thinking Qwen3 Instruct model.
The older `qwen3:4b` tag currently points to a thinking model and should not be
used for Earl's tool loop. GPT-OSS requires
a reasoning level and defaults to `low`; set `medium` or `high` only when a task
needs deeper planning because higher levels take longer and use more tokens.

Enable detailed console diagnostics for one PowerShell session:

```powershell
$env:EARL_LLM_DEBUG="true"
$env:EARL_OLLAMA_THINK="medium"
npm start
```

Debug mode logs the prompt, separate thinking field, raw final content, tool
calls, tool results, and timing to the Node console. Only the short sanitized
final answer is sent to Minecraft. For faster normal use, close that terminal
and start Earl again without those temporary variables, or set thinking to
`low` for GPT-OSS.

## Command queues

Use `then` to execute commands sequentially. Only the first command starts with `earl`:

```text
earl gather dirt 5 then store dirt 5 then follow me
```

Add `repeat` or `then repeat` at the end to safely repeat the queue until `earl stop` is entered:

```text
earl goto 273 64 368 then gather stone 4 then goto 236 64 381 then store cobblestone 4 then repeat
```

Repeating queues pause between iterations so chat and stop commands remain responsive. If an action times out, Earl cancels the underlying Minecraft work and stops that queue rather than starting conflicting actions.

## Automatic combat

Earl starts in `defensive` mode. He automatically defends himself or the latest player who commanded him, equips his best available sword or axe, and interrupts ordinary work only when a threat is close enough.

- `passive` — Never starts combat automatically.
- `defensive` — Responds to damage and hostiles within four blocks.
- `guard` — Protects Earl and his player within eight blocks.
- `aggressive` — Hunts supported hostile mobs within sixteen blocks.

Earl will not begin reflex combat at eight health or lower. `earl stop` immediately ends combat and suppresses the reflex for ten seconds so it cannot restart at once. Endermen and zombified piglins are ignored unless Earl or his protected player is hurt, except in aggressive mode.

The reflex also waits two seconds before retrying the same entity. This prevents repeated combat starts and chat/log spam while still allowing Earl to retry an unfinished fight.

## Friendly item and block names

Item commands accept amounts before or after the name, spaces instead of underscores, and common plural forms. These are equivalent:

```text
earl gather birch_log 64
earl gather 64 birch_logs
earl gather 64 birch logs
```

Placement also accepts an optional `nearby` word:

```text
earl place crafting_table
earl place crafting table nearby
```

The friendlier parsing applies to `gather`, `craft`, `store`, `take`, `equip`, and `place`. Exact Minecraft names remain the most reliable option.

## Multi-step crafting

`craft` performs one recipe with ingredients Earl already has. `make` creates craftable intermediate ingredients first. For example, with two logs and a crafting table nearby:

```text
earl make wooden pickaxe 1
```

Earl can turn logs into planks, planks into sticks, and then craft the pickaxe. He reports the missing raw material if the plan cannot be completed. Batch 9 plans crafting only: it does not automatically gather missing raw materials or place a crafting table yet.

## Development

Install dependencies and run the automated tests:

```cmd
npm install
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before changing `main`.
