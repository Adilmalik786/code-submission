/* helper functions to help with invoicing */
const moment = require('moment-timezone')
const _ = require('lodash')

const ShiftModel = require('../models/shift')
const FacilityProfileModel = require('../models/facilityProfile')
const InvoiceModel = require('../models/invoice')
const logger = require('../../utils/logger')

// helper function to generate invoice data
const getInvoiceData = (facilityId, startDate, endDate) => {

  const query = {
    facilityId,
    $and: [
      { start: { $gte: moment(startDate).startOf('day').toDate() } },
      { start: { $lte: moment(endDate).endOf('day').toDate() } }
    ],
    agentId: { $ne: null },
    $or: [{deleted: true, isBillable: true}, {deleted: {$ne: true}} ]
  }

  return ShiftModel.find(query)
  .populate({
    path: 'agentId',
    populate: {
      path: 'agent',
      select: { qualification: 1, name: 1, license: 1 }
    }
  })
  .populate('facilityId')

  .sort({ start: 1 })
  .then(async res => {
    let shifts = res.map(shift => {

      // IMPORTANT: store description string to read properly in facility's timezone
      const start = moment(shift.start).tz(shift.facilityId.tmz)
      const agent = shift.agentId.agent

      const amount = shift.time * shift.charge
      const cost = shift.time * shift.pay

      const qualification = _.get(agent, 'qualification', '---').toUpperCase()
      const shiftName = _.get(shift, 'name', '---').toUpperCase()
      return {
        description: `${start.format('MM/DD/YYYY')}, ${qualification} ${agent.name}, ${shiftName}, ${shift.deleted? '(Late Cancel)':''}`,
        shiftId: shift._id,
        hours: shift.time,
        rate: shift.charge,
        pay: shift.pay,
        amount,
        cost,
        profit: amount - cost,
        note: shift.note,
        verified: shift.verified,
        signed: shift.signed,
        signatory: shift.signatory,
        start: shift.start,
        end: shift.end,
        shiftDate: start.format('MM/DD/YYYY'),
        agentName: agent.name,
        agent: { _id: agent._id, license: agent.license, qualification: agent.qualification },
        shiftName: shift.name.toUpperCase(),
        agentReq: shift.agentReq,
        timecard: shift.timecard,
        clockInOut: shift.clockInOut,
        lunchInOut: shift.lunchInOut,
        unit: shift.unit,
        agentSignature: shift.agentSignature,
        deleted: shift.deleted
      }
    })

    const facilityData= await FacilityProfileModel.findOne({userId: facilityId})

    return { shifts, lineItems: [], expiryInDays: facilityData.netTerms }
  })
  .catch(err => {
    logger.error('' + err)
    return null
  })
}

/**
 * Get most recently created invoices for given facilities for a given period 
 */
const mostRecentInvoicesForFacilities = async (facilities, start) => {
  let invoices = await InvoiceModel.find({
    ...getInvoicePeriodFilter(start)
  }).sort({ count: -1 }).
  populate({
    path: 'facilityId',
    populate: {
      path: 'facility',
      model: 'FacilityProfile'
    }
  })

  let facilityInvoices = {}
  invoices.forEach(invoice => {
    if (!invoice.facilityId) {
      return
    }
    const facilityId = invoice.facilityId._id.toString()
    if (facilityInvoices[facilityId] || !facilities.includes(facilityId)) {
      return null
    }
    facilityInvoices[facilityId] = invoice
  })
  return facilityInvoices
}

/**
 * Create invoices for the passed facilities for a given period
 */
const generateInvoicesForFacilities = async (facilities, start, end) => {
  const lastInvoice = await InvoiceModel.findOne({}).sort({ count: -1 })
  let count = lastInvoice ? lastInvoice.count + 1 : 100

  await Promise.all(facilities.map(async (facilityId, index) => {
    const invoiceCount = count + index
    let data = await getInvoiceData(facilityId, start, end)
    data.lineItems = []
    const invoiceData = {
      facilityId,
      count: invoiceCount,
      data,
      period: { start, end },
      expiryInDays: data.netTerms
    }

    if (start < '2019-06-01') {
      invoiceData.start = moment(start)
      invoiceData.end = moment(end)
    }
    await markPreviousInvoiceAsArchived(facilityId)
    await InvoiceModel.create(invoiceData)
  }))
}

const getInvoicePeriodFilter = start => {
  if (start >= '2019-06-01') {
    return { 'period.start': start }
  }

  const oldPeriod = {
    $gte: moment(start)
      .subtract(1, 'day')
      .toDate(),
    $lt: moment(start)
      .add(1, 'day')
      .toDate(),
  }
  return { start: oldPeriod }
}

const markPreviousInvoiceAsArchived = (facilityId, start, end) => {
  const condition = {
    facilityId: facilityId,
    archived: false,
    "period.start": start,
    "period.end": end
  }
  return InvoiceModel.findOneAndUpdate(condition, { $set: { archived: true }})
}

const getSummary = invoices => {
  if(_.isEmpty(invoices)){
    return []
  }
  return invoices.map(invoice => {
    return {
      invoiceNumber: invoice.count,
      expiryInDays: invoice.expiryInDays,
      facilityName: _.get(invoice, "facilityId.facility.name", ""),
      datesCovered: `${moment(invoice.period.start).format('MM/DD/YYYY')} - ${moment(invoice.period.end).format('MM/DD/YYYY')}`,
      dateSent: moment(invoice.sentAt).tz(invoice.facilityId.tmz).format('MM/DD/YYYY'),
      amountPayable: invoice.data.shifts.reduce((acc, curr) => {
        acc += curr.amount
        return acc
      }, 0)
    }
  })
}

module.exports = { 
  getInvoiceData, 
  mostRecentInvoicesForFacilities,
  getInvoicePeriodFilter,
  generateInvoicesForFacilities,
  markPreviousInvoiceAsArchived,
  getSummary
}
