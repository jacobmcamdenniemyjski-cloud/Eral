class TaskScheduler {
  constructor() {
    this.currentTask = null
    this.pausedTasks = []
  }

  setTask(task) {
    if (
      !this.currentTask ||
      (task.priority || 0) >= (this.currentTask.priority || 0)
    ) {
      if (this.currentTask) {
        this.pausedTasks.push(this.currentTask)
      }

      this.currentTask = task
      return true
    }

    return false
  }

  clearTask() {
    this.currentTask = null
  }

  resumePreviousTask() {
    this.currentTask = this.pausedTasks.pop() || null
    return this.currentTask
  }

  getCurrentTask() {
    return this.currentTask
  }
}

module.exports = TaskScheduler