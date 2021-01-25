const mongoose = require('mongoose')

const LocationModel = require('../models/location')

const ObjectId = mongoose.Types.ObjectId

const logger = require('../../utils/logger')

const getNearbyLocationsUsingId = async (locationIds, getLocationInfo = false) => {

  if (!Array.isArray(locationIds)) {
    locationIds = [locationIds]
  }

  if (locationIds.length === 0) {
    return []
  }

  locationIds = locationIds.map(ObjectId)

  const locationPipeline = [
    {
      $match: {
        _id: {
          $in: locationIds,
        },
      },
    },
    {
      $lookup: {
        from: 'locations',
        localField: 'groups',
        foreignField: 'groups',
        as: 'nearbyLocations',
      },
    },
    {
      $unwind: {
        path: '$nearbyLocations',
        preserveNullAndEmptyArrays: true
      },
    }
  ]

  if (getLocationInfo) {
    // return locations as separate documents
    locationPipeline.push({
      $group: {
        _id: '$nearbyLocations._id',
        name: {
          $first: '$nearbyLocations.name'
        },
        groups: {
          $first: '$nearbyLocations.groups'
        },
      }
    })
  } else {
    // return only location Id
    locationPipeline.push({
      $group: {
        _id: 'nearbyLocations',
        locations: {
          $addToSet: '$nearbyLocations._id',
        },
      },
    })
  }

  const nearbyLocations = await LocationModel.aggregate(locationPipeline)

  if (getLocationInfo) {

    // Some locations doesn't have groups
    if (nearbyLocations[0]._id) {
      return nearbyLocations
    }

    return LocationModel.find({ _id: { $in: locationIds } })

  } else {
    const { locations } = nearbyLocations[0]

    // Some locations doesn't have groups
    return (locations.length === 0) ? locationIds : locations
  }
}

// Create a map of `group name` => [ list of locations ]
const getLocationsByGroup = () => {
  // TODO: store all our locations + groups in a cache
  let groupMap = {}
  return LocationModel.find({})
    .then(locations => {
      locations = locations.filter(location => location.groups && location.groups.length > 0)

      locations.forEach(location => {
        location.groups.forEach(group => {
          if (groupMap.hasOwnProperty(group)) {
            let list = groupMap[group]
            if (!list.find(listLoc => ObjectId(listLoc._id).equals(ObjectId(location._id)))) {
              list.push(location)
              groupMap[group] = list
            }
          } else {
            groupMap[group] = [location]
          }
        })
      })
      return groupMap
    })
    .catch(err => logger.error('' + err))
}

module.exports = {
  getNearbyLocationsUsingId,
  getLocationsByGroup
}
