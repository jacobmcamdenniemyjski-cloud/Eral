const { goals } = require('mineflayer-pathfinder')
const {
  inventoryCount,
  inventoryTotal,
  waitForCondition
} = require('../actions/verifiedState')

function positionObject(position) {
  return {
    x: Number(position.x),
    y: Number(position.y),
    z: Number(position.z)
  }
}

function inspectBlockAt(bot, position) {
  const target = positionObject(position)
  const block = bot.blockAt(target)
  if (!block) {
    return { position: target, loaded: false, name: null }
  }
  let properties = {}
  try {
    properties = typeof block.getProperties === 'function'
      ? block.getProperties()
      : {}
  } catch {}
  return {
    position: target,
    loaded: true,
    name: block.name,
    type: block.type,
    boundingBox: block.boundingBox,
    properties
  }
}

function expectedDropIds(bot, block) {
  const definition = bot.registry.blocks && bot.registry.blocks[block.type]
  const drops = definition && Array.isArray(definition.drops)
    ? definition.drops.map(Number).filter(Number.isFinite)
    : []
  const item = bot.registry.itemsByName && bot.registry.itemsByName[block.name]
  if (drops.length === 0 && item) drops.push(item.id)
  return [...new Set(drops)]
}

async function equipTool(bot, block) {
  const definition = bot.registry.blocks && bot.registry.blocks[block.type]
  const toolIds = Object.keys((definition && definition.harvestTools) || {})
    .map(Number)
  if (toolIds.length === 0) return null
  if (bot.heldItem && toolIds.includes(bot.heldItem.type)) return bot.heldItem
  const tool = bot.inventory.items().find((item) => toolIds.includes(item.type))
  if (!tool) throw new Error(`no valid tool is available for ${block.name}`)
  await bot.equip(tool, 'hand')
  return tool
}

async function breakBlockAt(bot, input, options = {}) {
  const { signal } = options
  const target = positionObject(input.position)
  if (signal && signal.aborted) throw signal.reason
  const block = bot.blockAt(target)
  if (!block || block.name === 'air') {
    return {
      status: 'failed',
      position: target,
      message: 'The target position is already air.'
    }
  }
  if (input.expectedBlock && block.name !== input.expectedBlock) {
    return {
      status: 'failed',
      position: target,
      actualBlock: block.name,
      message: `Expected ${input.expectedBlock}, but found ${block.name}; nothing was broken.`
    }
  }

  const distance = bot.entity.position.distanceTo(block.position)
  if (distance > 4.5) {
    await bot.pathfinder.goto(
      new goals.GoalNear(target.x, target.y, target.z, 2)
    )
  }
  if (signal && signal.aborted) throw signal.reason
  const current = bot.blockAt(target)
  if (!current || current.name !== block.name) {
    return {
      status: 'failed',
      position: target,
      actualBlock: current ? current.name : null,
      message: 'The target changed before it could be broken.'
    }
  }

  await equipTool(bot, current)
  const dropIds = expectedDropIds(bot, current)
  const before = Object.fromEntries(dropIds.map((id) => [
    id,
    inventoryCount(bot, id)
  ]))
  const totalBefore = inventoryTotal(bot)
  await bot.dig(current, true)
  const changed = await waitForCondition(bot, () => {
    const after = bot.blockAt(target)
    return !after || after.name !== current.name ? true : null
  }, { signal, ticks: 40 })
  if (!changed) {
    return {
      status: 'failed',
      position: target,
      actualBlock: bot.blockAt(target) && bot.blockAt(target).name,
      message: `The server did not confirm breaking ${current.name}.`
    }
  }

  const recovered = await waitForCondition(bot, () => {
    const gain = dropIds.length > 0
      ? dropIds.reduce((total, id) => (
          total + Math.max(0, inventoryCount(bot, id) - (before[id] || 0))
        ), 0)
      : Math.max(0, inventoryTotal(bot) - totalBefore)
    return gain > 0 ? gain : null
  }, { signal, ticks: 20 }) || 0

  return {
    status: recovered > 0 || dropIds.length === 0 ? 'completed' : 'partial',
    position: target,
    block: current.name,
    broken: true,
    recovered,
    message: recovered > 0 || dropIds.length === 0
      ? `Broke ${current.name} at the exact requested position.`
      : `Broke ${current.name}, but its drop was not recovered.`
  }
}

module.exports = {
  breakBlockAt,
  inspectBlockAt
}
