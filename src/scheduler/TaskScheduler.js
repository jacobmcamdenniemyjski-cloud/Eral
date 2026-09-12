class TaskScheduler {
  constructor() {
    this.currentTask = null
  }

  setTask(task) {
    if (
      !this.currentTask ||
      (task.priority || 0) >= (this.currentTask.priority || 0)
    ) {
      this.currentTask = task
      return true
    }

    return false
  }

  clearTask() {
    this.currentTask = null
  }

  getCurrentTask() {
    return this.currentTask
  }
}

module.exports = TaskScheduler