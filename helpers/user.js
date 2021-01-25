/* helper functions to help with users */
const mongoose = require('mongoose')

const UserModel = require('../models/user')
const ExclusionModel = require('../models/exclusion')
const { getLocationsByGroup } = require('../helpers/location')
const logger = require('../../utils/logger')
const { formatRequirements } = require('../../utils/requirements')

const ObjectId = mongoose.Types.ObjectId


async function pipelineAgents(args) {
  // include requirements by default, skip last notification by default
  const includeRequirements = args.includeRequirements ? args.includeRequirements : true
  const includeLastNotification = args.includeLastNotification ? args.includeLastNotification : false
  const userIds = args.userIds
  const facilityUserId = args.facilityUserId

  let agents = await pipelineAgentsDB(includeRequirements, includeLastNotification, userIds, facilityUserId)

  // do extra work to format agents, not blocking event loop
  async function formatAgent(i, callback) {
    let agent = agents[i]
    if (agent.agent.uploads) {
      agent.agent.uploads = agent.agent.uploads.map(u => {
        // return the upload object combined with the requirement
        return {
          ...u,
          requirement: agent.agent.uploadRequirements.find(r => ObjectId(r._id).equals(ObjectId(u.requirement)))
        }
      })
    }

    agent = formatRequirements(agent)
    agent.addedBy = agent.addedBy ? agent.addedBy[0] : null

    if (includeLastNotification) {
      let latestNotif = null
      agent.messages.forEach(message => {
        if (!['SMS', 'SMS_BROADCAST'].includes(message.method)) {
          return
        }
        if (!latestNotif || message.createdAt > latestNotif.createdAt) {
          latestNotif = message
        }
      })
      agent.lastNotified = latestNotif
    }
    agents[i] = agent
    if (i < agents.length - 1) {
      setImmediate(formatAgent.bind(null, i + 1, callback))
      return
    }
    callback(agents)
  }
  if (agents.length === 0) {
    return agents
  }
  return new Promise(resolve => {
    formatAgent(0, function (agents) {
      resolve(agents)
    })
  })
}

const pipelineAgentsDB = async (includeRequirements, includeLastNotification, userIds, facilityUserId) =>{
  let blockedWorkers = []

  if (facilityUserId) {
    const facilityExclusions = await ExclusionModel.find({ facility: facilityUserId, archived: { $ne: true } })
    blockedWorkers = facilityExclusions.map(({agent}) => ObjectId(agent))
  }

  const match = userIds ?
    { _id: { $in: userIds } } :
    { type: 'AGENT', _id: { $nin: blockedWorkers } }
  
  let query = [
    { $match:  match },
    { $lookup: {
        from: 'agentprofiles',
        localField: 'agent',
        foreignField: '_id',
        as: 'agent'
      }
    },
    { $unwind: '$agent' },
    { $lookup: {
        from: 'users',
        localField: 'addedBy',
        foreignField: '_id',
        as: 'addedBy'
      }
    },
    { $lookup: {
        from: 'locations',
        localField: 'agent.locations',
        foreignField: '_id',
        as: 'agent.locations'
      }
    }
  ]
  if (includeRequirements) { // Due to Unwind, removes workers without any requirements set
    // query.push(
    //   { $lookup: {
    //       from: 'documents',
    //       localField: 'agent.requirements.requirement',
    //       foreignField: '_id',
    //       as: 'agent.requirements'
    //     }
    //   }
    // )
    query = query.concat([
      { $addFields: {
        docExpirations: '$agent.requirements'
      }},
      { $unwind : {
          path:'$docExpirations',
          preserveNullAndEmptyArrays: true
        }
      },
      { $lookup: {
          from: 'documents',
          localField: 'docExpirations.requirement',
          foreignField: '_id',
          as: 'docExpirations_data'
        }
      },
      { $unwind: {
          path: '$docExpirations_data',
          preserveNullAndEmptyArrays: true
        }
      },
      { $addFields:
        { 'docExpirations_data.expires': '$docExpirations.expires' }
      },
      { $group: {
        _id: "$_id",
        type: {$first: '$type'},
        email: {$first: '$email'},
        agent: {$first: '$agent'},
        tmz: {$first: '$tmz'},
        flags: {$first: '$flags'},
        deactivated: { $first: '$deactivated' },
        createdAt: {$first: '$createdAt'},
        'docExpirations_data': {$push: "$docExpirations_data" },
      }},
      {
        $addFields: {
          'agent.requirements': {
            // prevent empty objects
            $filter: {
              input: "$docExpirations_data",
              as: "item",
              cond: { $gt: ["$$item._id", null] }
            }
          }
        }
      },
      { $project: {
        docExpirations_data: 0
      }},
      { $sort: { _id: 1 }}
    ])
    query.push(
      { $lookup: {
          from: 'documents',
          localField: 'agent.uploads.requirement',
          foreignField: '_id',
          as: 'agent.uploadRequirements'
        }
      }
    )
  }
  if (includeLastNotification) {
    query.push(
      { $lookup: {
          from: 'messages',
          localField: '_id',
          foreignField: 'agentId',
          as: 'messages'
        }
      }
    )
  }

  return UserModel.aggregate(query)
    .allowDiskUse(true)
    .exec()
    .then(users => users)
    .catch(err => logger.error('' + err))
}

async function pipelineFacilities(args) {

  // include requirements by default
  const includeRequirements = args.includeRequirements ? args.includeRequirements : true
  const userId = args.userId

  let facilities = await pipelineFacilitiesDB(includeRequirements, userId)

  function formatFacility(i, callback) {
    let facility = facilities[i]
    facility = formatRequirements(facility)
    facility.addedBy = facility.addedBy ? facility.addedBy[0] : null
    facility.facility.location = facility.facility.location ? facility.facility.location[0] : null

    facilities[i] = facility
    if (i < facilities.length - 1) {
      setImmediate(formatFacility.bind(null, i + 1, callback))
      return
    }
    callback(facilities)
  }

  return new Promise(resolve => {
    formatFacility(0, function (facilities) {
      resolve(facilities)
    })
  })
}

const pipelineFacilitiesDB = (includeRequirements, userId) => {
  const match = userId
                ? { _id: ObjectId(userId) }
                : { type: 'FACILITY' }

  let query = [
    { $match: match },
    { $lookup: {
        from: 'users',
        localField: 'addedBy',
        foreignField: '_id',
        as: 'addedBy'
      }
    },
    { $lookup: {
        from: 'facilityprofiles',
        localField: 'facility',
        foreignField: '_id',
        as: 'facility'
      },
    },
    { $unwind: '$facility' },
    { $lookup: {
        from: 'locations',
        localField: 'facility.location',
        foreignField: '_id',
        as: 'facility.location'
      }
    }
  ]
  if (includeRequirements) {
    query.push(
      { $lookup: {
          from: 'documents',
          localField: 'facility.requiredDocuments',
          foreignField: '_id',
          as: 'facility.requiredDocuments'
        }
      }
    )
  }

  return UserModel.aggregate(query).exec()
    .then(users => users)
    .catch(err => logger.error('' + err))
}

/*
  When this method needs to be called for many agents (eg: inside a loop),
    pre-generate a groupMap and pass it in as the optional second parameter.
 */
const getAgentEligibleLocations = (user, groupMap=null) => {
  const { agent } = user
  const getGroupMap = new Promise(resolve => {
    if (groupMap) {
      // just return what was passed to us
      resolve(groupMap)
    }
    resolve(getLocationsByGroup())
  })

  return getGroupMap.then(groupMap => {
    let locations = agent.locations.map(loc => loc)

    agent.locations.forEach(agentLoc => {
      if (!agentLoc.groups || agentLoc.groups.length === 0) {
        return
      }

      // for locations in groups, add other locations they're grouped with
      agentLoc.groups.forEach(group => {
        groupMap[group].forEach(groupLoc => {
          if (!locations.find(loc => ObjectId(loc._id).equals(ObjectId(groupLoc._id)))) {
            locations.push(groupLoc)
          }
        })
      })
    })
    return locations
  })
}

/*
  When this method needs to be called for many agents (eg: inside a loop),
    pre-generate a groupMap and pass it in as the optional second parameter.
 */
const getAgentNearbyFacilities = (user, facilities, groupMap=null) => {
  return getAgentEligibleLocations(user, groupMap).then(locations => {
    return facilities.filter(f => {
      if (!f.facility.location) {
        return false
      }
      return locations.find(loc => ObjectId(loc._id).equals(ObjectId(f.facility.location._id)))
    })
  })
}

module.exports = {
  pipelineAgents,
  pipelineFacilities,
  getAgentNearbyFacilities,
}
