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

function getPositiveInteger(value, fallback = 1) {
  const number = Number(value)

  if (!Number.isInteger(number) || number <= 0) {
    return fallback
  }

  return number
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

    const success = await craftItem(bot, itemName, amount)

    if (!success) {
      bot.chat(`I could not craft ${itemName}.`)
    }
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

    const target = attackNearestHostile(bot, mobName)

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
