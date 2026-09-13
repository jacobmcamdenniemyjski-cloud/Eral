const REGISTRY_KEYS = {
  block: ['blocksByName'],
  item: ['itemsByName'],
  either: ['itemsByName', 'blocksByName']
}

const GENERIC_FAMILIES = {
  log: {
    matches: (name) => name.endsWith('_log'),
    preferred: 'oak_log'
  },
  wood: {
    matches: (name) => name.endsWith('_log'),
    preferred: 'oak_log'
  },
  tree: {
    matches: (name) => name.endsWith('_log'),
    preferred: 'oak_log'
  },
  plank: {
    matches: (name) => name.endsWith('_planks'),
    preferred: 'oak_planks'
  }
}

function normalizeResourceName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getNameCandidates(value) {
  const normalized = normalizeResourceName(value)
  const candidates = [normalized]

  if (normalized.endsWith('ies')) {
    candidates.push(`${normalized.slice(0, -3)}y`)
  }

  if (normalized.endsWith('s')) {
    candidates.push(normalized.slice(0, -1))
  }

  if (normalized.endsWith('es')) {
    candidates.push(normalized.slice(0, -2))
  }

  return [...new Set(candidates.filter(Boolean))]
}

function getGenericFamily(value) {
  for (const candidate of getNameCandidates(value)) {
    if (GENERIC_FAMILIES[candidate]) return GENERIC_FAMILIES[candidate]
  }

  return null
}

function getMatchingRegistryNames(bot, registryKey, family) {
  const entries = Object.entries(
    (bot.registry && bot.registry[registryKey]) || {}
  )

  return entries
    .filter(([name]) => family.matches(name))
    .map(([name, definition]) => ({ name, definition }))
}

function resolveInventoryFamily(bot, matches) {
  if (!bot.inventory || typeof bot.inventory.items !== 'function') return null

  const allowedNames = new Set(matches.map((match) => match.name))
  const counts = new Map()

  for (const item of bot.inventory.items()) {
    if (!allowedNames.has(item.name)) continue
    counts.set(item.name, (counts.get(item.name) || 0) + item.count)
  }

  return Array.from(counts)
    .sort((left, right) => right[1] - left[1])[0]?.[0] || null
}

function resolveNearbyBlockFamily(bot, matches) {
  if (typeof bot.findBlock !== 'function') return null

  const ids = matches
    .map((match) => match.definition && match.definition.id)
    .filter(Number.isInteger)

  if (ids.length === 0) return null

  const found = bot.findBlock({ matching: ids, maxDistance: 32 })
  return found && found.name ? found.name : null
}

function resolveGenericResourceName(bot, value, kind) {
  const family = getGenericFamily(value)
  if (!family) return null

  if (kind === 'item' || kind === 'either') {
    const itemMatches = getMatchingRegistryNames(bot, 'itemsByName', family)
    const inventoryMatch = resolveInventoryFamily(bot, itemMatches)
    if (inventoryMatch) return inventoryMatch

    const preferredItem = itemMatches.find(({ name }) => (
      name === family.preferred
    ))
    if (preferredItem && kind === 'item') return preferredItem.name
  }

  if (kind === 'block' || kind === 'either') {
    const blockMatches = getMatchingRegistryNames(bot, 'blocksByName', family)
    const nearbyMatch = resolveNearbyBlockFamily(bot, blockMatches)
    if (nearbyMatch) return nearbyMatch

    const preferredBlock = blockMatches.find(({ name }) => (
      name === family.preferred
    ))
    if (preferredBlock) return preferredBlock.name
    if (blockMatches[0]) return blockMatches[0].name
  }

  if (kind === 'item') {
    const itemMatches = getMatchingRegistryNames(bot, 'itemsByName', family)
    if (itemMatches[0]) return itemMatches[0].name
  }

  return null
}

function resolveResourceName(bot, value, kind = 'either') {
  const registryKeys = REGISTRY_KEYS[kind] || REGISTRY_KEYS.either

  for (const candidate of getNameCandidates(value)) {
    if (registryKeys.some((key) => (
      bot.registry && bot.registry[key] && bot.registry[key][candidate]
    ))) {
      return candidate
    }
  }

  return resolveGenericResourceName(bot, value, kind)
}

function parseStrictPositiveInteger(value) {
  if (!/^\d+$/.test(String(value || ''))) return null

  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function parseItemRequest(bot, text, options = {}) {
  const {
    kind = 'item',
    defaultAmount = 1,
    allowAmount = true,
    ignoredTrailingWords = []
  } = options
  const ignored = new Set(
    ignoredTrailingWords.map((word) => word.toLowerCase())
  )
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean)

  while (
    tokens.length > 0 &&
    ignored.has(tokens[tokens.length - 1].toLowerCase())
  ) {
    tokens.pop()
  }

  if (tokens.length === 0) return null

  let amount = defaultAmount
  const firstAmount = parseStrictPositiveInteger(tokens[0])
  const lastAmount = tokens.length > 1
    ? parseStrictPositiveInteger(tokens[tokens.length - 1])
    : null

  if (!allowAmount && (firstAmount || lastAmount)) return null
  if (firstAmount && lastAmount) return null

  if (allowAmount && firstAmount) {
    amount = firstAmount
    tokens.shift()
  } else if (allowAmount && lastAmount) {
    amount = lastAmount
    tokens.pop()
  }

  if (tokens.length === 0) return null

  const inputName = tokens.join('_')
  const normalizedName = normalizeResourceName(inputName)
  const resolvedName = resolveResourceName(bot, inputName, kind)

  return {
    name: resolvedName || normalizedName,
    amount,
    known: Boolean(resolvedName)
  }
}

module.exports = {
  normalizeResourceName,
  parseItemRequest,
  resolveResourceName,
  resolveGenericResourceName
}
