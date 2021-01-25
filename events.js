const { registerServices } = require('./services')
const { publishEvent, listenForEvents } = require('../utils/pubsub')

class ServiceEvent {
  constructor() {
  }

  on(...args) {
    const [subscriptionName, handler, options] = args
    listenForEvents(subscriptionName, handler, options)
  }

  emit(...args) {
    const [topicName, data] = args
    publishEvent({
      event: topicName,
      data,
    })
  }
}

const serviceEvent = new ServiceEvent()

registerServices(serviceEvent)

module.exports = { serviceEvent }
