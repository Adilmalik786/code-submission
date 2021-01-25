const AgentModel = require('../models/agentProfile')
const { toArrayObjectIds } = require('../../utils/array')
const { WORKER_STAGES_ENUM } = require('../../utils/worker')

const getAgentFacilities = ({ userId, agentId, optOutOfText }) => {
  let filter = { stage: { $nin: [WORKER_STAGES_ENUM.PROBATION, WORKER_STAGES_ENUM.TERMINATED] } }

  if (userId) {
    filter = { userId: { $in: toArrayObjectIds(userId) } }
  }

  if (agentId) {
    filter = { _id: { $in: toArrayObjectIds(agentId) } }
  }

  if (optOutOfText && typeof optOutOfText === 'boolean') {
    filter.optOutOfText = { $ne: true }
  }

  return AgentModel.aggregate([
    // Filter by agent
    { $match: filter },
    // Unwind agent locations
    { $unwind: { path: '$locations', preserveNullAndEmptyArrays: true } },
    // Get location info
    {
      $lookup: {
        from: 'locations',
        localField: 'locations',
        foreignField: '_id',
        as: 'locationGroup',
      },
    },
    { $unwind: { path: '$locationGroup', preserveNullAndEmptyArrays: true } },
    // Get locations for location group
    {
      $lookup: {
        from: 'locations',
        localField: 'locationGroup.groups',
        foreignField: 'groups',
        as: 'nearbyLocations',
      },
    },
    { $unwind: { path: '$nearbyLocations', preserveNullAndEmptyArrays: true } },
    // Get unique nearby location ids
    {
      $group: {
        _id: '$userId',
        agentId: { $first: '$_id' },
        name: { $first: '$name' },
        phone: { $first: '$phone' },
        rate: { $first: '$rate' },
        qualification: { $first: '$qualification' },
        requirements: { $first: '$requirements' },
        notifyFlags: { $first: '$notifyFlags' },
        nearbyLocations: { $addToSet: '$nearbyLocations._id' },
        locations: { $addToSet: '$locations' },
      },
    },
    // Some locations don't have location group
    {
      $addFields: {
        eligibleLocations: { $setUnion: ['$nearbyLocations', '$locations'] },
      },
    },
    // Get nearby facilities
    {
      $lookup: {
        from: 'facilityprofiles',
        localField: 'eligibleLocations',
        foreignField: 'location',
        as: 'nearbyFacilities',
      },
    },
    {
      $unwind: { path: '$nearbyFacilities', preserveNullAndEmptyArrays: true },
    },
    {
      $group: {
        _id: '$_id',
        agentId: { $first: '$agentId' },
        name: { $first: '$name' },
        phone: { $first: '$phone' },
        rate: { $first: '$rate' },
        qualification: { $first: '$qualification' },
        requirements: { $first: '$requirements' },
        notifyFlags: { $first: '$notifyFlags' },
        nearbyFacilities: {
          $push: {
            _id: '$nearbyFacilities.userId',
            name: '$nearbyFacilities.name',
            requiredDocuments: '$nearbyFacilities.requiredDocuments',
          },
        },
      },
    },
    {
      $lookup: {
        from: 'exclusions',
        let: { agentId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$agent", "$$agentId"] },
                  { $ne: ["$archived", true] }
                ]
              }
            }
          }
        ],
        as: 'blockedList'
      }
    },
    { $unwind: { path: '$blockedList', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$_id',
        agentId: { $first: '$agentId' },
        name: { $first: '$name' },
        phone: { $first: '$phone' },
        rate: { $first: '$rate' },
        qualification: { $first: '$qualification' },
        requirements: { $first: '$requirements' },
        notifyFlags: { $first: '$notifyFlags' },
        nearbyFacilities: { $first: '$nearbyFacilities' },
        excludedFacilities: { $push: '$blockedList.facility' },
      },
    },
    // Remove null qualifiedFacilities & excluded facilities
    {
      $project: {
        _id: 1,
        agentId: 1,
        name: 1,
        phone: 1,
        rate: 1,
        qualification: 1,
        requirements: 1,
        excludedFacilities: 1,
        notifyFlags: 1,
        nearbyFacilities: {
          $filter: {
            input: '$nearbyFacilities',
            as: 'facility',
            cond: {
              $and: [
                { $gt: ['$$facility._id', null] },
                { $not: { $in: ['$$facility._id', '$excludedFacilities'] } },
              ],
            },
          },
        },
      },
    },
  ])
    .allowDiskUse(true)
}

const getAgentQualifiedFacilities = ({ agentId, optOutOfText }) => {
  let filter = { stage: { $ne: WORKER_STAGES_ENUM.TERMINATED } }

  if (agentId) {
    filter = { _id: { $in: toArrayObjectIds(agentId) } }
  }

  if (optOutOfText && typeof optOutOfText === 'boolean') {
    filter.optOutOfText = { $ne: true }
  }

  return AgentModel.aggregate([
    {
      $match: filter
    },
    {
      $project: {
        _id: 1,
        userId: 1,
        name: 1,
        phone: 1,
        rate: 1,
        qualification: 1,
        requirements: 1,
        excludedFacilities: 1,
        notifyFlags: 1,
        qualifiedFacilities: "$facilities.qualified"
      }
    }
  ])
}

module.exports = { getAgentFacilities, getAgentQualifiedFacilities }
