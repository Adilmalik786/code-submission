const mongoose = require('mongoose')
const { mapValues } = require('lodash')

const ShiftModel = require('../../models/shift')

const { roundDecimal } = require('../../../utils/numbers')

const { ObjectId } = mongoose.Types

const getEndDate = (date, type) => {
  if (type === 'daily') {
    return date.clone().endOf('day')
  } else if (type === 'weekly') {
    return date.clone().endOf('week')
  } else {
    return date.clone().endOf('month')
  }
}

const getShiftInfo = shiftId =>
  ShiftModel.findOne({ _id: shiftId }, { start: 1, facilityId: 1 }).lean()

const getAggregateMetric = async (facilityId, date, type) => {
  const endDate = getEndDate(date, type)
  const metrics = await ShiftModel.aggregate([
    {
      $match: {
        start: { $gte: date.toDate(), $lte: endDate.toDate() },
        facilityId: facilityId,
        $or: [{deleted: true, isBillable: true}, {deleted: {$ne: true}} ],
      },
    },
    {
      $group: {
        _id: '$agentReq',
        requested: {
          $sum: 1,
        },
        filled: {
          $sum: { $cond: [{$and :[ { $gt: ['$agentId', null] }, { $ne:['$deleted',true] } ]}, 1, 0] },
        },
        expectedRevenue: {
          $sum: {  $cond: [ {$ne: ['$deleted', true]}, {$multiply: ['$time', '$charge']}, 0] },
        },
        grossRevenue: {
          $sum: { $cond: ['$agentId', { $multiply: ['$time', '$charge'] }, 0] },
        },
        netRevenue: {
          $sum: {
            $cond: [
              '$agentId',
              {
                $subtract: [
                  { $multiply: ['$time', '$charge'] },
                  { $multiply: ['$time', '$pay'] },
                ],
              },
              0,
            ],
          },
        },
        totalMargin: {
          $sum: { $cond: [
            {$and :[ { $gt: ['$agentId', null] }, { $ne:['$deleted',true] } ]},
             { $subtract: ['$charge', '$pay'] }, 0] },
        },
        uniqueWorkers: {
          $addToSet: { $cond: [ {$ne: ['$deleted', true]}, '$agentId', null] },
        },
      },
    },
  ])
  return metrics || []
}

/**
 * 
 * @param {('daily'|'weekly'|'monthly')} type 
 */
const getEntireAggregateMetric = async (type) => {
  let groupBy
  if (type === 'daily') {
    groupBy = {
      year: {
        $year: {
          date: '$start',
          timezone: 'America/Los_Angeles',
        }
      },
      day: {
        $dayOfYear: {
          date: '$start',
          timezone: 'America/Los_Angeles',
        }
      },
    }
  } else if (type === 'weekly') {
    groupBy = {
      year: {
        $isoWeekYear: {
          date: '$start',
          timezone: 'America/Los_Angeles',
        }
      },
      week: {
        $isoWeek: {
          date: '$start',
          timezone: 'America/Los_Angeles',
        }
      },
    }
  } else {
    groupBy = {
      year: {
        $year: {
          date: '$start',
          timezone: 'America/Los_Angeles',
        }
      },
      month: {
        $month: {
          date: '$start',
          timezone: 'America/Los_Angeles',
        }
      },
    }
  }

  const metrics = await ShiftModel.aggregate([
    {
      $match: {
        // Invalid facility Id's
        facilityId: {
          $nin: [
            ObjectId('5b6dfbbb6ce3150014cc74c8'),
            ObjectId('5b6f1293625376001402de11'),
            ObjectId('5b6f1364625376001402de13'),
          ],
        },
        deleted: { $ne: true },
      },
    },
    {
      $group: {
        _id: groupBy,
        facilities: {
          $addToSet: '$facilityId',
        },
      },
    },
    {
      $sort: {
        _id: 1
      },
    },
  ])
  return metrics
}

const mapToCurrentRangeMetric = (shiftMetrics, isPrevious) => {
  const currentShifts = {
    requested: 0,
    filled: 0,
    fillRate: 0,
    uniqueWorkers: 0,
  }
  const currentRevenue = {
    expected: 0,
    gross: 0,
    net: 0,
    totalMargin: 0,
    avgMargin: 0,
  }

  const breakDownByReqType = {}

  shiftMetrics.forEach(metric => {
    const reqType = metric._id

    const currentShiftsByReqType = {
      requested: metric.requested,
      filled: metric.filled,
      fillRate: (metric.filled / metric.requested) * 100,
      uniqueWorkers: metric.uniqueWorkers.length
    }
    // add these to total object also
    currentShifts.requested += metric.requested
    currentShifts.filled += metric.filled
    currentShifts.uniqueWorkers += metric.uniqueWorkers.length

    const currentRevenueByReqType = {
      expected: metric.expectedRevenue,
      gross: metric.grossRevenue,
      net: metric.netRevenue,
      avgMargin: metric.totalMargin / metric.filled,
    }

    // add to total object
    currentRevenue.expected += metric.expectedRevenue
    currentRevenue.gross += metric.grossRevenue
    currentRevenue.net += metric.netRevenue
    currentRevenue.totalMargin += metric.totalMargin

    if (isPrevious) {
      breakDownByReqType[reqType] = {
        previousShifts: mapValues(currentShiftsByReqType, value =>
          roundDecimal(value)
        ),
        previousRevenue: mapValues(currentRevenueByReqType, value =>
          roundDecimal(value)
        ),
      }
    } else {
      breakDownByReqType[reqType] = {
        currentShifts: mapValues(currentShiftsByReqType, value =>
          roundDecimal(value)
        ),
        currentRevenue: mapValues(currentRevenueByReqType, value =>
          roundDecimal(value)
        ),
      }
    }
    
  })

  currentShifts.fillRate =
    (currentShifts.filled / currentShifts.requested) * 100
  currentRevenue.avgMargin = currentRevenue.totalMargin / currentShifts.filled

  if (isPrevious) {
    return {
      ...breakDownByReqType,
      all: {
        previousShifts: mapValues(currentShifts, metric => roundDecimal(metric)),
        previousRevenue: mapValues(currentRevenue, metric => roundDecimal(metric)),
      },
    }
  }

  return {
    ...breakDownByReqType,
    all: {
      currentShifts: mapValues(currentShifts, metric => roundDecimal(metric)),
      currentRevenue: mapValues(currentRevenue, metric => roundDecimal(metric)),
    },
  }
}

/**
 * Return calculated metric for daily, weekly or monthly
 * @param facilityId
 * @param date
 * @param {('daily'|'weekly'|'monthly')} type
 */
const calculateMetric = async (facilityId, date, type, isPrevious) => {
  const shiftMetrics = await getAggregateMetric(facilityId, date, type)
  return mapToCurrentRangeMetric(shiftMetrics, isPrevious)
}

const mapChurnValue = (newValue, value) => {
  if (isNaN(value)) return roundDecimal(0 - newValue)
  return roundDecimal(value - newValue)
}

const calculateChurnMetric = (currentMetric, previousMetric) => {
  if (!previousMetric) {
    return mapValues(currentMetric, (value) => {
      return roundDecimal(0 - value)
    })
  }

  if (!currentMetric) {
    return mapValues(previousMetric, (value) => {
      return roundDecimal(value)
    })
  }
  const metric = mapValues(previousMetric, (value, key) =>
    mapChurnValue(currentMetric[key], value)
  )
  return metric
}

module.exports = {
  getEntireAggregateMetric,
  calculateMetric,
  calculateChurnMetric,
  getShiftInfo,
}
