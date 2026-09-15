const BANNED_FOOD = new Set([
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'chorus_fruit',
  'chicken',
  'suspicious_stew',
  'golden_apple'
])

function foodData(bot, item) {
  if (!item || !bot.registry) return null
  if (bot.registry.foodsByName) {
    return bot.registry.foodsByName[item.name] || null
  }
  return null
}

async function eatNow(bot, options = {}) {
  const { signal } = options
  if (signal && signal.aborted) throw signal.reason
  if (bot.food >= 20) return { ate: false, reason: 'already_full' }

  const foods = bot.inventory.items()
    .map((item) => ({ item, data: foodData(bot, item) }))
    .filter(({ item, data }) => data && !BANNED_FOOD.has(item.name))
    .sort((a, b) => (b.data.foodPoints || 0) - (a.data.foodPoints || 0))

  if (foods.length === 0) throw new Error('No safe food is available.')

  const chosen = foods[0].item
  const previous = bot.heldItem
  await bot.equip(chosen, 'hand')
  if (signal && signal.aborted) throw signal.reason
  await bot.consume()

  if (
    previous &&
    bot.inventory.items().some((item) => item.slot === previous.slot)
  ) {
    try {
      await bot.equip(previous, 'hand')
    } catch {}
  }

  console.log(`Earl ate ${chosen.name}.`)
  return { ate: true, food: chosen.name, foodLevel: bot.food }
}

module.exports = eatNow
module.exports.BANNED_FOOD = BANNED_FOOD
