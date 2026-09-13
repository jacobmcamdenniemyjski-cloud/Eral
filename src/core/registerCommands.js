const followPlayer = require('../movement/followPlayer')
const stopMovement = require('../movement/stopMovement')
const goTo = require('../movement/goTo')
const lookAtPlayer = require('../movement/lookAtPlayer')

const findNearestBlock = require('../perception/findNearestBlock')
const getStatus = require('../perception/getStatus')
const getNearbyEntities = require('../perception/getNearbyEntities')
const getInventory = require('../perception/getInventory')

const gatherBlock = require('../gathering/gatherBlock')
const craftItem = require('../crafting/craftItem')
const attackNearestHostile = require('../combat/attackNearestHostile')
const storeItem = require('../inventory/storeItem')
const takeItem = require('../inventory/takeItem')
const equipItem = require('../inventory/equipItem')
const { placeBlock } = require('../building/placeBlock')
const buildLine = require('../building/buildLine')
const buildWall = require('../building/buildWall')
const buildFloor = require('../building/buildFloor')

function getPositiveInteger(value, fallback = 1) {
  const number = Number(value)

  if (!Number.isInteger(number) || number <= 0) {
    return fallback
  }

  return number
}

function getBuildOrigin(parts, startIndex = 1) {
  const coordinates = parts
    .slice(startIndex, startIndex + 3)
    .map(Number)

  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isInteger)
  ) {
    return null
  }

  return {
    x: coordinates[0],
    y: coordinates[1],
    z: coordinates[2]
  }
}

function registerCommands(bot, scheduler, router) {
  bot.on('stoppedAttacking', () => {
    const currentTask = scheduler.getCurrentTask()

    if (currentTask && currentTask.type === 'attack') {
      scheduler.clearTask()
    }
  })

  router.exact('earl inventory', async () => {
    console.log(getInventory(bot))
  })

  router.prefix('earl gather', async ({ args }) => {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)

    if (!blockName) {
      bot.chat('Usage: earl gather <block> <amount>')
      return
    }

    await gatherBlock(bot, blockName, amount)
  })

  router.prefix('earl craft', async ({ args }) => {
    const parts = args.split(/\s+/)
    const itemName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)

    if (!itemName) {
      bot.chat('Usage: earl craft <item> <amount>')
      return
    }

    await craftItem(bot, itemName, amount)
  })

  router.prefix('earl store', async ({ args }) => {
    const parts = args.split(/\s+/)
    const itemName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)

    if (!itemName) {
      bot.chat('Usage: earl store <item> <amount>')
      return
    }

    await storeItem(bot, itemName, amount)
  })

  router.prefix('earl take', async ({ args }) => {
    const parts = args.split(/\s+/)
    const itemName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)

    if (!itemName) {
      bot.chat('Usage: earl take <item> <amount>')
      return
    }

    await takeItem(bot, itemName, amount)
  })

  router.prefix('earl equip', async ({ args }) => {
    const itemName = args.trim()

    if (!itemName) {
      bot.chat('Usage: earl equip <item>')
      return
    }

    await equipItem(bot, itemName)
  })

  router.prefix('earl place', async ({ args }) => {
  const parts = args.split(/\s+/)
  const blockName = parts[0]

  if (!blockName) {
    bot.chat('Usage: earl place <block> [x y z]')
    return
  }

  const hasCoords = parts.length > 1
  const position = hasCoords ? getBuildOrigin(parts) : null

  if (hasCoords && !position) {
    bot.chat('Usage: earl place <block> [x y z]')
    return
  }

  try {
    const result = await placeBlock(bot, blockName, position)

    if (result.skipped) {
      bot.chat(`${blockName} is already at that position.`)
    } else {
      bot.chat(`Placed ${blockName}.`)
    }
  } catch (error) {
    console.error(`Placement failed: ${error.message}`)
    bot.chat(`I could not place ${blockName}: ${error.message}`)
  }
})

  router.prefix('earl build line', async ({ args }) => {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const origin = getBuildOrigin(parts)
    const direction = parts[4] && parts[4].toLowerCase()
    const length = Number(parts[5])

    if (!blockName || !origin || !direction || !Number.isInteger(length)) {
      bot.chat('Usage: earl build line <block> <x> <y> <z> <direction> <length>')
      return
    }

    await buildLine(bot, blockName, origin, direction, length)
  })

  router.prefix('earl build wall', async ({ args }) => {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const origin = getBuildOrigin(parts)
    const direction = parts[4] && parts[4].toLowerCase()
    const width = Number(parts[5])
    const height = Number(parts[6])

    if (
      !blockName ||
      !origin ||
      !direction ||
      !Number.isInteger(width) ||
      !Number.isInteger(height)
    ) {
      bot.chat('Usage: earl build wall <block> <x> <y> <z> <direction> <width> <height>')
      return
    }

    await buildWall(
      bot,
      blockName,
      origin,
      direction,
      width,
      height
    )
  })

  router.prefix('earl build floor', async ({ args }) => {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const origin = getBuildOrigin(parts)
    const width = Number(parts[4])
    const depth = Number(parts[5])

    if (
      !blockName ||
      !origin ||
      !Number.isInteger(width) ||
      !Number.isInteger(depth)
    ) {
      bot.chat('Usage: earl build floor <block> <x> <y> <z> <width> <depth>')
      return
    }

    await buildFloor(bot, blockName, origin, width, depth)
  })

  router.exact('earl task', async () => {
    console.log(scheduler.getCurrentTask())
  })

  router.exact('earl follow me', async ({ username }) => {
    const accepted = scheduler.setTask({
      type: 'follow',
      target: username,
      priority: 200
    })

    if (accepted) {
      followPlayer(bot, username)
    }
  })

  router.prefix('earl find', async ({ args }) => {
    const blockName = args.trim()

    if (!blockName) {
      bot.chat('Usage: earl find <block>')
      return
    }

    const block = findNearestBlock(bot, blockName)

    if (block) {
      console.log({ name: block.name, position: block.position })
    } else {
      console.log(`No ${blockName} found nearby.`)
    }
  })

  router.exact('earl stop', async () => {
    scheduler.clearTask()

    if (bot.pvp) {
      bot.pvp.forceStop()
    }

    stopMovement(bot)
  })

  router.prefix('earl attack', async ({ args }) => {
    const mobName = args.trim().toLowerCase()

    if (!mobName) {
      bot.chat('Usage: earl attack <hostile mob>')
      return
    }

    const accepted = scheduler.setTask({
      type: 'attack',
      target: mobName,
      priority: 300
    })

    if (!accepted) {
      bot.chat('I am already handling a higher-priority task.')
      return
    }

    const target = await attackNearestHostile(bot, mobName)

    if (!target) {
      scheduler.clearTask()
    }
  })

  router.exact('earl look at me', async ({ username }) => {
    await lookAtPlayer(bot, username)
  })

  router.exact('earl status', async () => {
    console.log(getStatus(bot))
  })

  router.exact('earl scan', async () => {
    console.log(getNearbyEntities(bot))
  })

  router.prefix('earl goto', async ({ args }) => {
    const parts = args.split(/\s+/)
    const x = Number(parts[0])
    const y = Number(parts[1])
    const z = Number(parts[2])

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      bot.chat('Usage: earl goto <x> <y> <z>')
      return
    }

    const accepted = scheduler.setTask({
      type: 'goto',
      x,
      y,
      z,
      priority: 200
    })

    if (accepted) {
      goTo(bot, x, y, z)
    }
  })
}

module.exports = registerCommands
