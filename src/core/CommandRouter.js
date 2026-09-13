class CommandRouter {
  constructor(bot) {
    this.bot = bot
    this.routes = []
  }

  exact(command, handler) {
    this.routes.push({
      type: 'exact',
      command: command.toLowerCase(),
      handler
    })

    return this
  }

  prefix(command, handler) {
    this.routes.push({
      type: 'prefix',
      command: command.toLowerCase(),
      handler
    })

    return this
  }

  async handle(username, message) {
    const text = message.trim()
    const lower = text.toLowerCase()

    for (const route of this.routes) {
      if (route.type === 'exact' && lower === route.command) {
        await route.handler({ username, text, args: '' })
        return true
      }

      if (
        route.type === 'prefix' &&
        (lower === route.command || lower.startsWith(`${route.command} `))
      ) {
        const args = text.slice(route.command.length).trim()
        await route.handler({ username, text, args })
        return true
      }
    }

    return false
  }
}

module.exports = CommandRouter
