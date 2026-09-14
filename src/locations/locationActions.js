const goTo = require('../movement/goTo')

function currentDimension(bot) {
  const dimension = bot.game && bot.game.dimension
  return typeof dimension === 'string' ? dimension : null
}

function positionSummary(location) {
  return `${location.x}, ${location.y}, ${location.z}`
}

async function markCurrentLocation(bot, store, name) {
  if (!bot.entity || !bot.entity.position) {
    throw new Error('Earl does not have a world position yet.')
  }

  const position = bot.entity.position
  const location = await store.set(name, {
    x: position.x,
    y: position.y,
    z: position.z,
    dimension: currentDimension(bot)
  })

  console.log(
    `Saved location "${location.name}" at ${positionSummary(location)}.`
  )
  return location
}

async function goToSavedLocation(bot, store, name, options = {}) {
  const location = await store.get(name)
  if (!location) throw new Error(`No saved location named "${name}".`)

  const dimension = currentDimension(bot)
  if (
    location.dimension &&
    dimension &&
    location.dimension !== dimension
  ) {
    throw new Error(
      `"${location.name}" is in ${location.dimension}, not ${dimension}.`
    )
  }

  const travel = options.travel || goTo
  await travel(bot, location.x, location.y, location.z, {
    tolerance: options.tolerance || 2,
    signal: options.signal
  })

  return location
}

module.exports = {
  currentDimension,
  goToSavedLocation,
  markCurrentLocation,
  positionSummary
}
