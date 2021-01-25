const GenericError = require('./GenericError')

class MissingArgsError extends GenericError {
  constructor(args) {
		const message = `Missing at least one of the required arguments: ${args.join(', ')}`
		super(400, message, 'MissingArgsError')
	}
}

module.exports = MissingArgsError
