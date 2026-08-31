class ErrorLog {
  constructor() {
    this.errors = [];
  }

  log(level, message, context = {}) {
    this.errors.push({
      level,
      message,
      context,
      timestamp: new Date().toISOString()
    });
  }

  warn(message, context) {
    this.log('warn', message, context);
  }

  error(message, context) {
    this.log('error', message, context);
  }

  info(message, context) {
    this.log('info', message, context);
  }

  getAll() {
    return this.errors;
  }

  getByLevel(level) {
    return this.errors.filter(e => e.level === level);
  }

  clear() {
    this.errors = [];
  }

  toJSON() {
    return {
      errorCount: this.errors.length,
      errors: this.errors
    };
  }
}

module.exports = ErrorLog;
