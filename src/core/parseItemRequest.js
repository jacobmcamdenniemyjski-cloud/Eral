const REGISTRY_KEYS = {
  block: ['blocksByName'],
  item: ['itemsByName'],
  either: ['itemsByName', 'blocksByName']
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

function resolveResourceName(bot, value, kind = 'either') {
  const registryKeys = REGISTRY_KEYS[kind] || REGISTRY_KEYS.either

  for (const candidate of getNameCandidates(value)) {
    if (registryKeys.some((key) => (
      bot.registry && bot.registry[key] && bot.registry[key][candidate]
    ))) {
      return candidate
    }
  }

  return null
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
  resolveResourceName
}
