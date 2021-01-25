const moment = require('moment-timezone')
const mongoose = require('mongoose')
const { get, uniq } = require('lodash')

const {
  calculateChurnMetric,
  calculateMetric,
  getEntireAggregateMetric,
  getShiftInfo,
} = require('./shiftHelper')
const {
  findFacilityMetric,
  upsertFacilityMetric,
  getFacilityInfo,
} = require('./facilityHelper')

const { ObjectId } = mongoose.Types

const fetchPreviousDateMetric = async (facilityId, date, type) => {
  let previousDate // current date here will always be start of the day or week or month.
  if (type === 'daily') {
    previousDate = date
      .clone()
      .subtract(1, 'day')
  } else if (type === 'weekly') {
    previousDate = date
      .clone()
      .subtract(1, 'week')
  } else if (type === 'monthly') {
    previousDate = date
      .clone()
      .subtract(1, 'month')
  }
  let previousMetric = await findFacilityMetric(facilityId, previousDate.toDate())

  if (previousMetric && previousMetric[type]) {
    const convertedToPreviousFormat = {}
    Object.keys(previousMetric[type]).forEach(reqType => {
      convertedToPreviousFormat[reqType] = {
        previousShifts: previousMetric[type][reqType].currentShifts,
        previousRevenue: previousMetric[type][reqType].currentRevenue,
      }
    })
    return convertedToPreviousFormat
  }
  return calculateMetric(facilityId, previousDate, type, true)
}


const fetchNextDateMetric = async (facilityId, date, type) => {
  let nextDate // current date here will always be start of the day or week or month.
  if (type === 'daily') {
    nextDate = date
      .clone()
      .add(1, 'day')
  } else if (type === 'weekly') {
    nextDate = date
      .clone()
      .add(1, 'week')
  } else if (type === 'monthly') {
    nextDate = date
      .clone()
      .add(1, 'month')
  }
  let nextDateMetric = await findFacilityMetric(facilityId, nextDate.toDate())
  return [nextDateMetric, nextDate]
}

/**
 * Returns existing metric doc if exists or calculate needed info
 * @param facilityId
 * @param date
 * @param {('daily'|'weekly'|'monthly')} type
 */
const fetchFacilityMetricInfo = async (facilityId, date, type) => {
  const facilityMetric = await findFacilityMetric(facilityId, date.toDate())
  if (facilityMetric && facilityMetric[type]) {
    return facilityMetric
  }
  const facility = await getFacilityInfo(facilityId)
  const previousMetric = await fetchPreviousDateMetric(facilityId, date, type)
  return {
    facilityId: facility.userId,
    facilityType: facility.type,
    name: facility.name,
    date: date.toDate(),
    [type]: previousMetric,
  }
}

const FacilityMetricService = (serviceEvent) => {
  const options = { maxMessages: 3 }
  serviceEvent.on('shiftUpdate-facilityMetric', onShiftUpdate, options)
}


const processNextDateMetric = async (facilityId, date, type, previousMetric) => {
  const [nextDateMetric, nextDate] = await fetchNextDateMetric(facilityId, date, type)

  const currentMetrics = (nextDateMetric && nextDateMetric[type]) || {}

  const newMetric = {}

  const allReqTypes = uniq([...Object.keys(currentMetrics), ...Object.keys(previousMetric)])

  allReqTypes.forEach(reqType => {
    const churnShifts = calculateChurnMetric(
      get(currentMetrics[reqType], 'currentShifts'),
      get(previousMetric[reqType], 'currentShifts')
    )

    const churnRevenue = calculateChurnMetric(
      get(currentMetrics[reqType], 'currentRevenue'),
      get(previousMetric[reqType], 'currentRevenue')
    )

    newMetric[reqType] = {
      ...currentMetrics[reqType],
      previousShifts: get(previousMetric[reqType], 'currentShifts'),
      previousRevenue: get(previousMetric[reqType], 'currentRevenue'),
      churnShifts,
      churnRevenue,
    }
  })

  let newFacilityMetric

  if (nextDateMetric) {
    newFacilityMetric = {
      ...nextDateMetric,
      [type]: newMetric
    }
  } else {
    const facility = await getFacilityInfo(facilityId)

    newFacilityMetric = {
      facilityId: facility.userId,
      facilityType: facility.type,
      name: facility.name,
      date: nextDate.toDate(),
      [type]: newMetric
    }
  }

  return await upsertFacilityMetric(newFacilityMetric)
}

/**
 * Updates existing metric doc or insert the new one
 * @param facilityId
 * @param date
 * @param {('daily'|'weekly'|'monthly')} type
 */
const processMetricForDate = async (facilityId, date, type) => {
  console.log('procession metric for ', facilityId, date.format(), type)
  const facilityMetric = await fetchFacilityMetricInfo(
    ObjectId(facilityId),
    date,
    type
  )

  const shiftMetric = await calculateMetric(ObjectId(facilityId), date, type)

  const previousMetric = facilityMetric[type]

  const newMetric = {}

  const allReqTypes = uniq([...Object.keys(shiftMetric), ...Object.keys(previousMetric)])

  allReqTypes.forEach(reqType => {
    const churnShifts = calculateChurnMetric(
      get(shiftMetric[reqType], 'currentShifts'),
      get(previousMetric[reqType], 'previousShifts')
    )

    const churnRevenue = calculateChurnMetric(
      get(shiftMetric[reqType], 'currentRevenue'),
      get(previousMetric[reqType], 'previousRevenue')
    )

    newMetric[reqType] = {
      ...previousMetric[reqType],
      ...shiftMetric[reqType],
      churnShifts,
      churnRevenue,
    }
  })

  const newFacilityMetric = {
    ...facilityMetric,
    [type]: newMetric
  }

  await upsertFacilityMetric(newFacilityMetric)

  // update for next Date
  return await processNextDateMetric(facilityId, date, type, shiftMetric)
}

const onShiftUpdate = async (data, { daily = true, weekly = true, monthly = true } = {}) => {
  let { shiftId, facilityId, start } = data

  console.log('shift updated called ', data)
  if (!facilityId || !start) {
    const shiftInfo = await getShiftInfo(shiftId)
    facilityId = shiftInfo.facilityId
    start = shiftInfo.start
  }

  const dayStart = moment(start).startOf('day')
  const weekStart = moment(start).startOf('week')
  const monthStart = moment(start).startOf('month')

  daily && await processMetricForDate(facilityId, dayStart, 'daily')
  weekly && await processMetricForDate(facilityId, weekStart, 'weekly')
  monthly && await processMetricForDate(facilityId, monthStart, 'monthly')
  return
}


const getMomentFromDateGroup = (dateGroup, type) => {
  if (type === 'daily') {
    return moment(`${dateGroup.year}-${dateGroup.day}`, 'Y-DDD').toDate()
  }
  if (type === 'weekly') {
    return moment(`${dateGroup.year}-${dateGroup.week}`, 'Y-W').toDate()
  }
  return moment(`${dateGroup.year}-${dateGroup.month}`, 'Y-M').toDate()
}

/**
 * 
 * @param {('daily'|'weekly'|'monthly')} type 
 */
const generateAllMetricData = async (type) => {
  const metrics = await getEntireAggregateMetric(type)
  
  for (let index = 0; index < metrics.length; index++) {
    const { _id: dateGroup, facilities } = metrics[index]
    await Promise.all(
      facilities.map(async facilityId => {
        await onShiftUpdate({
          facilityId,
          start: getMomentFromDateGroup(dateGroup, type),
        }, {
          daily: false,
          weekly: false,
          monthly: false,
          [type]: true,
        })
      })
    )
    console.log(`Facility Metrics : type = ${type} : Metrics processed count: ${index}`)
  }
  console.log('end')
}

module.exports = { generateAllMetricData, FacilityMetricService, onShiftUpdate }
