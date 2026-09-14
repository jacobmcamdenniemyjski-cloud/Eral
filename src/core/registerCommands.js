const stopMovement = require('../movement/stopMovement')
const CombatReflex = require('../combat/CombatReflex')
const CommandQueue = require('../scheduler/CommandQueue')
const createSkillRegistry = require('../skills/createSkillRegistry')
const { parseItemRequest } = require('./parseItemRequest')
const { resolveCropName } = require('../farming/crops')

function getBuildOrigin(parts, startIndex = 1) {
  const coordinates = parts.slice(startIndex, startIndex + 3).map(Number)

  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isInteger)
  ) {
    return null
  }

  return { x: coordinates[0], y: coordinates[1], z: coordinates[2] }
}

function sendChatChunks(bot, message, maxLength = 220) {
  const words = String(message || '').trim().split(/\s+/).filter(Boolean)
  const chunks = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word.slice(0, maxLength)
    } else if (`${current} ${word}`.length <= maxLength) {
      current = `${current} ${word}`
    } else {
      chunks.push(current)
      current = word.slice(0, maxLength)
    }
  }

  if (current) chunks.push(current)
  for (const chunk of chunks.slice(0, 3)) bot.chat(chunk)
}

function registerCommands(bot, scheduler, router) {
  bot.on('stoppedAttacking', () => {
    const currentTask = scheduler.getCurrentTask()
    if (currentTask && currentTask.type === 'attack') scheduler.clearTask()
  })

  async function cancelActiveWork() {
    if (
      bot.collectBlock &&
      typeof bot.collectBlock.cancelTask === 'function'
    ) {
      try {
        await Promise.race([
          Promise.resolve(bot.collectBlock.cancelTask()),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
      } catch (error) {
        console.error(`Collect cancellation failed: ${error.message}`)
      }
    }

    if (bot.pvp && typeof bot.pvp.forceStop === 'function') {
      try {
        bot.pvp.forceStop()
      } catch (error) {
        console.error(`Combat cancellation failed: ${error.message}`)
      }
    }

    if (bot.pathfinder) {
      try {
        bot.pathfinder.setGoal(null)
      } catch (error) {
        console.error(`Movement cancellation failed: ${error.message}`)
      }
    }

    if (bot.earl && bot.earl.doorOpener) {
      bot.earl.doorOpener.stop()
    }

    if (typeof bot.clearControlStates === 'function') {
      bot.clearControlStates()
    }

    if (bot.currentWindow && typeof bot.closeWindow === 'function') {
      try {
        await bot.closeWindow(bot.currentWindow)
      } catch (error) {
        console.error(`Window cancellation failed: ${error.message}`)
      }
    }

    scheduler.clearTask()
    await new Promise((resolve) => setImmediate(resolve))
  }

  const commandQueue = new CommandQueue({
    cancelActiveWork,
    repeatDelayMs: 1000,
    maxSegments: 20,
    notify: (message) => bot.chat(message),
    onStart: (label) => console.log(`[queue] starting: ${label}`),
    onFinish: (label) => console.log(`[queue] finished: ${label}`),
    onError: (label, error, timedOut) => {
      console.error(`[queue] step failed: "${label}" — ${error.message}`)

      if (timedOut) {
        bot.chat(`"${label}" took too long and was safely stopped.`)
      } else {
        bot.chat(`Couldn't finish "${label}": ${error.message}. Moving on.`)
      }
    }
  })

  const combatReflex = new CombatReflex(bot, scheduler, {
    mode: 'defensive',
    cancelForThreat: (reason) => commandQueue.cancel(reason),
    notify: (message) => bot.chat(message)
  })
  combatReflex.start()

  const skillRegistry = createSkillRegistry({ bot, scheduler, combatReflex })

  async function runSkill(name, input, context) {
    const result = await skillRegistry.execute(name, input, {
      ...context,
      cancelActiveWork
    })

    if (result.ok) return result.data
    if (result.error.code === 'SKILL_FAILED') return false

    if (result.error.code === 'SKILL_CANCELLED' && context.signal.aborted) {
      throw context.signal.reason || new Error(result.error.message)
    }

    const error = new Error(result.error.message)
    if (result.error.code === 'SKILL_TIMEOUT') error.code = 'ACTION_TIMEOUT'
    throw error
  }

  function queueTimeoutFor(skillName) {
    const skill = skillName && skillRegistry.get(skillName)
    return (skill ? skill.timeoutMs : 30000) + 5000
  }

  async function handleGather(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'block' })
    if (!request) return bot.chat('Usage: gather <block> <amount>')
    if (request.amount > 64) {
      return bot.chat('Gather at most 64 blocks per command.')
    }

    return runSkill('gather_block', {
      block: request.name,
      amount: request.amount
    }, context)
  }

  async function handleCraft(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })
    if (!request) return bot.chat('Usage: craft <item> <amount>')

    return runSkill('craft_item', {
      item: request.name,
      amount: request.amount
    }, context)
  }

  async function handleMake(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })
    if (!request) return bot.chat('Usage: make <item> <amount>')
    if (request.amount > 64) {
      return bot.chat('Make at most 64 items per command.')
    }

    return runSkill('make_item', {
      item: request.name,
      amount: request.amount
    }, context)
  }

  async function handleFarm(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'either' })
    const crop = request && resolveCropName(request.name)

    if (!request || !crop) {
      return bot.chat(
        'Usage: farm <wheat|carrots|potatoes|beetroots|all> <amount>'
      )
    }

    if (request.amount > 64) {
      return bot.chat('Farm at most 64 crops per command.')
    }

    return runSkill('farm_crops', {
      crop,
      amount: request.amount
    }, context)
  }

  async function handleFarmStatus(args, context) {
    const crop = resolveCropName(args.trim() || 'all')
    if (!crop) {
      return bot.chat(
        'Usage: farm status [wheat|carrots|potatoes|beetroots|all]'
      )
    }

    const status = await runSkill('get_farm_status', { crop }, context)
    if (!status) return false

    const mature = status.crops.reduce(
      (total, entry) => total + entry.mature,
      0
    )
    const growing = status.crops.reduce(
      (total, entry) => total + entry.growing,
      0
    )

    console.log('Farm status:', status)
    bot.chat(
      `Farm: ${mature} mature, ${growing} growing, ` +
      `${status.emptyFarmland} empty farmland.`
    )
    return status
  }

  async function handleSmelt(args, context) {
    const parts = args.split(/\s+with\s+/i)
    if (parts.length > 2) {
      return bot.chat('Usage: smelt <item> <amount> [with <fuel>]')
    }

    const request = parseItemRequest(bot, parts[0], { kind: 'item' })
    if (!request) {
      return bot.chat('Usage: smelt <item> <amount> [with <fuel>]')
    }

    const input = {
      item: request.name,
      amount: request.amount
    }

    if (parts[1]) {
      const fuel = parseItemRequest(bot, parts[1], {
        kind: 'item',
        allowAmount: false
      })
      if (!fuel) return bot.chat('I do not recognize that furnace fuel.')
      input.fuel = fuel.name
    }

    return runSkill('smelt_item', input, context)
  }

  async function handleFurnaceStatus(args, context) {
    return runSkill('get_furnace_status', {}, context)
  }

  async function handleFurnaceCollect(args, context) {
    return runSkill('collect_furnace_output', {}, context)
  }

  async function handleStore(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })
    if (!request) return bot.chat('Usage: store <item> <amount>')

    return runSkill('store_item', {
      item: request.name,
      amount: request.amount
    }, context)
  }

  async function handleTake(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })
    if (!request) return bot.chat('Usage: take <item> <amount>')

    return runSkill('take_item', {
      item: request.name,
      amount: request.amount
    }, context)
  }

  async function handleEquip(args, context) {
    const request = parseItemRequest(bot, args, {
      kind: 'item',
      allowAmount: false
    })
    if (!request) return bot.chat('Usage: equip <item>')

    return runSkill('equip_item', { item: request.name }, context)
  }

  async function handlePlace(args, context) {
    const parts = args.trim().split(/\s+/).filter(Boolean)

    if (
      parts[parts.length - 1] &&
      parts[parts.length - 1].toLowerCase() === 'nearby'
    ) {
      parts.pop()
    }

    let position = null
    const coordinateStart = parts.length - 3
    const coordinateCandidate = coordinateStart > 0
      ? getBuildOrigin(parts, coordinateStart)
      : null

    if (coordinateCandidate) {
      position = coordinateCandidate
      parts.splice(coordinateStart, 3)
    }

    const request = parseItemRequest(bot, parts.join(' '), {
      kind: 'block',
      allowAmount: false
    })
    if (!request) return bot.chat('Usage: place <block> [x y z]')

    try {
      const input = { block: request.name }
      if (position) input.position = position
      const result = await runSkill('place_block', input, context)

      if (result) {
        bot.chat(
          result.skipped
            ? `${request.name} is already at that position.`
            : `Placed ${request.name}.`
        )
      }
      return result
    } catch (error) {
      if (context.signal.aborted) throw error

      console.error(`Placement failed: ${error.message}`)
      bot.chat(`I could not place ${request.name}: ${error.message}`)
      return false
    }
  }

  async function handleBuildLine(args, context) {
    const parts = args.split(/\s+/)
    const origin = getBuildOrigin(parts, 1)
    const direction = parts[4] && parts[4].toLowerCase()
    const length = Number(parts[5])

    if (!parts[0] || !origin || !direction || !Number.isInteger(length)) {
      return bot.chat(
        'Usage: build line <block> <x> <y> <z> <direction> <length>'
      )
    }

    return runSkill('build_line', {
      block: parts[0], origin, direction, length
    }, context)
  }

  async function handleBuildWall(args, context) {
    const parts = args.split(/\s+/)
    const origin = getBuildOrigin(parts, 1)
    const direction = parts[4] && parts[4].toLowerCase()
    const width = Number(parts[5])
    const height = Number(parts[6])

    if (
      !parts[0] ||
      !origin ||
      !direction ||
      !Number.isInteger(width) ||
      !Number.isInteger(height)
    ) {
      return bot.chat(
        'Usage: build wall <block> <x> <y> <z> <direction> <width> <height>'
      )
    }

    return runSkill('build_wall', {
      block: parts[0], origin, direction, width, height
    }, context)
  }

  async function handleBuildFloor(args, context) {
    const parts = args.split(/\s+/)
    const origin = getBuildOrigin(parts, 1)
    const width = Number(parts[4])
    const depth = Number(parts[5])

    if (
      !parts[0] ||
      !origin ||
      !Number.isInteger(width) ||
      !Number.isInteger(depth)
    ) {
      return bot.chat(
        'Usage: build floor <block> <x> <y> <z> <width> <depth>'
      )
    }

    return runSkill('build_floor', {
      block: parts[0], origin, width, depth
    }, context)
  }

  async function handleGoto(args, context) {
    const coordinates = args.split(/\s+/).map(Number)
    if (
      coordinates.length !== 3 ||
      !coordinates.every(Number.isFinite)
    ) {
      return bot.chat('Usage: goto <x> <y> <z>')
    }

    const [x, y, z] = coordinates
    return runSkill('go_to', { x, y, z }, context)
  }

  async function handleAttack(args, context) {
    const mobName = args.trim().toLowerCase()
    if (!mobName) return bot.chat('Usage: attack <hostile_mob>')

    return runSkill('attack_hostile', {
      mob: mobName,
      maxDistance: 16
    }, context)
  }

  async function handleCombat(args, context) {
    const requestedMode = args.trim().toLowerCase()

    if (!requestedMode || requestedMode === 'status') {
      const status = await runSkill('get_combat_status', {}, context)
      bot.chat(
        `Combat is ${status.mode}` +
        (status.protecting ? `; protecting ${status.protecting}.` : '.')
      )
      return status
    }

    if (!['passive', 'defensive', 'guard', 'aggressive'].includes(requestedMode)) {
      bot.chat('Usage: combat <passive|defensive|guard|aggressive|status>')
      return false
    }

    const status = await runSkill('set_combat_mode', {
      mode: requestedMode,
      player: context.username
    }, context)
    if (status) bot.chat(`Combat mode set to ${requestedMode}.`)
    return status
  }

  async function handleFollowMe(args, context) {
    return runSkill('follow_player', { player: context.username }, context)
  }

  async function handleLookAtMe(args, context) {
    return runSkill('look_at_player', { player: context.username }, context)
  }

  async function handleStop(args, context) {
    return runSkill('stop_all', {}, context)
  }

  async function handleFind(args, context) {
    const request = parseItemRequest(bot, args, {
      kind: 'block',
      allowAmount: false
    })
    if (!request) return bot.chat('Usage: find <block>')

    const found = await runSkill('find_block', {
      block: request.name,
      maxDistance: 32
    }, context)
    console.log(found || `No ${request.name} found nearby.`)
    return found
  }

  async function handleStatus(args, context) {
    const status = await runSkill('get_status', {}, context)
    console.log(status)
    return status
  }

  async function handleScan(args, context) {
    const entities = await runSkill('scan_nearby', { range: 16 }, context)
    console.log(entities)
    return entities
  }

  async function handleInventory(args, context) {
    const inventory = await runSkill('get_inventory', {}, context)
    console.log(inventory)
    return inventory
  }

  async function handleTask(args, context) {
    const task = await runSkill('get_task', {}, context)
    console.log(task)
    return task
  }

  async function handleSkills() {
    const names = skillRegistry.list().map((skill) => skill.name)
    console.log('Available structured skills:', names)
    bot.chat(`${names.length} structured skills are available; see the console.`)
    return names
  }

  async function handleLlmStatus(args, context) {
    const agent = bot.earl && bot.earl.llmAgent
    if (!agent) {
      bot.chat('The Ollama agent is not configured.')
      return false
    }

    const status = await agent.getStatus({
      signal: context.signal,
      timeoutMs: 5000
    })
    console.log('Ollama status:', status)

    if (!status.connected) {
      bot.chat('Ollama is offline. Check the console for details.')
      return false
    }

    if (!status.modelInstalled) {
      bot.chat(`Ollama is online, but ${status.model} is not installed.`)
      return false
    }

    bot.chat(`Ollama is ready with ${status.model}.`)
    return status
  }

  async function handleAsk(args, context) {
    const request = args.trim()
    if (!request) return bot.chat('Usage: earl ask <natural language request>')

    const agent = bot.earl && bot.earl.llmAgent
    if (!agent) {
      bot.chat('The Ollama agent is not configured.')
      return false
    }

    bot.chat('Let me think.')
    const result = await agent.ask(context.username, request, context)

    if (!result.ok) {
      console.error(`Ollama request failed: ${result.error.message}`)
      bot.chat(`I could not finish that: ${result.error.message}`)
      return false
    }

    sendChatChunks(bot, result.message)
    return result
  }

  const verbs = [
    {
      verb: 'llm status',
      skill: null,
      handler: handleLlmStatus,
      passive: true,
      timeoutMs: 35000
    },
    { verb: 'build line', skill: 'build_line', handler: handleBuildLine },
    { verb: 'build wall', skill: 'build_wall', handler: handleBuildWall },
    { verb: 'build floor', skill: 'build_floor', handler: handleBuildFloor },
    { verb: 'follow me', skill: 'follow_player', handler: handleFollowMe },
    { verb: 'look at me', skill: 'look_at_player', handler: handleLookAtMe },
    { verb: 'gather', skill: 'gather_block', handler: handleGather },
    { verb: 'craft', skill: 'craft_item', handler: handleCraft },
    { verb: 'make', skill: 'make_item', handler: handleMake },
    {
      verb: 'farm status',
      skill: 'get_farm_status',
      handler: handleFarmStatus,
      passive: true
    },
    { verb: 'farm', skill: 'farm_crops', handler: handleFarm },
    { verb: 'harvest', skill: 'farm_crops', handler: handleFarm },
    {
      verb: 'furnace status',
      skill: 'get_furnace_status',
      handler: handleFurnaceStatus
    },
    {
      verb: 'furnace collect',
      skill: 'collect_furnace_output',
      handler: handleFurnaceCollect
    },
    { verb: 'smelt', skill: 'smelt_item', handler: handleSmelt },
    { verb: 'store', skill: 'store_item', handler: handleStore },
    { verb: 'take', skill: 'take_item', handler: handleTake },
    { verb: 'equip', skill: 'equip_item', handler: handleEquip },
    { verb: 'place', skill: 'place_block', handler: handlePlace },
    { verb: 'goto', skill: 'go_to', handler: handleGoto },
    { verb: 'attack', skill: 'attack_hostile', handler: handleAttack },
    { verb: 'combat', skill: 'get_combat_status', handler: handleCombat, passive: true },
    { verb: 'stop', skill: 'stop_all', handler: handleStop },
    { verb: 'find', skill: 'find_block', handler: handleFind, passive: true },
    { verb: 'status', skill: 'get_status', handler: handleStatus, passive: true },
    { verb: 'scan', skill: 'scan_nearby', handler: handleScan, passive: true },
    { verb: 'inventory', skill: 'get_inventory', handler: handleInventory, passive: true },
    { verb: 'task', skill: 'get_task', handler: handleTask, passive: true },
    { verb: 'skills', skill: null, handler: handleSkills, passive: true },
    {
      verb: 'ask',
      skill: null,
      handler: handleAsk,
      timeoutMs: 900000
    }
  ].map((entry) => ({
    ...entry,
    timeoutMs: entry.timeoutMs || queueTimeoutFor(entry.skill)
  }))

  function matchVerb(segment) {
    const lower = segment.toLowerCase()

    for (const entry of verbs) {
      if (lower === entry.verb || lower.startsWith(`${entry.verb} `)) {
        return {
          ...entry,
          args: segment.slice(entry.verb.length).trim()
        }
      }
    }

    return null
  }

  router.prefix('earl', async ({ args, username }) => {
    const text = args.trim()
    combatReflex.protect(username)
    const singleMatch = !/\s+then\s+|(?:^|\s)repeat\s*$/i.test(text)
      ? matchVerb(text)
      : null

    if (singleMatch && singleMatch.verb === 'stop') {
      combatReflex.suppress(10000)
      await commandQueue.stop('stopped by player')
      stopMovement(bot)
      bot.chat('Stopped.')
      return
    }

    if (singleMatch && singleMatch.passive) {
      await singleMatch.handler(singleMatch.args, {
        username,
        signal: new AbortController().signal,
        stopQueue: () => commandQueue.stop('stopped by command'),
        cancelActiveWork
      })
      return
    }

    if (
      !singleMatch &&
      text &&
      !/\s+then\s+|(?:^|\s)repeat\s*$/i.test(text)
    ) {
      bot.chat(`I don't know how to "${text}".`)
      return
    }

    // A direct player command takes control immediately. The short pause keeps
    // the reflex from restarting during queue handoff; a continuing threat can
    // still interrupt the new task one second later.
    combatReflex.suppress(1000)

    await commandQueue.run(
      text,
      {
        username,
        stopQueue: () => commandQueue.stop('stopped by queue command'),
        cancelActiveWork
      },
      matchVerb
    )
  })

  bot.earl = {
    ...(bot.earl || {}),
    skillRegistry,
    commandQueue,
    combatReflex,
    cancelActiveWork
  }

  return bot.earl
}

module.exports = registerCommands
