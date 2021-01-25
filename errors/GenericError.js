class GenericError extends Error {
	constructor(status, message, type = 'GenericError') {
		super(message)
		this.type = type
		this.status = status
	}
}

module.exports = GenericError
