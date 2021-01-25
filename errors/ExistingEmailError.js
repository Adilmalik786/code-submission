const GenericError = require('./GenericError')

class ExistingEmailError extends GenericError {
  constructor(email) {
    const message = `Email ${email} already in use`
    super(400, message, 'ExistingEmailError')
  }
}

module.exports = ExistingEmailError
