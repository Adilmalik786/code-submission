const express = require('express')
const mongoose = require('mongoose')
const _ = require('lodash')

const FacilityProfileModel = require('../models/facilityProfile')
const UserModel = require('../models/user')
const ExclusionModel = require('../models/exclusion')
const { serviceEvent } = require('../events')
const { toArrayObjectIds } = require('../../utils/array')
const { updateZenFacility } = require('../services/zenDesk/facility')
const { bitly } = require('../../utils/bitly')
const { sendSMS } = require('../../utils/sms')
const { sendRequestSignatureEmail } = require('../../utils/email')
const { FacilityStatusObj, FacilityStatus } = require('../../utils/facility')
const meta = require('../../utils/meta')
const { toPhoneNumber } = require('../services/helpers')
const { uploadImage, ImageFolders, ImageTags } = require('../../utils/image')
const { updateFacilityUserOnFacilityProfileChange } = require('./facilityUser/helpers')
const { workerTypeDefaults } = require('../../utils/worker')
const { httpError } = require('../../utils/errors')
const { FacilityStatusLogger } = require('../../utils/facilityStatusLogger')
const { logProfileChanges } = require('../../utils/profileChangeLogger')
const { ACTIONS, UPDATE_TYPES } = require('../../utils/profileChangeLogger/constants')
const StatusLogsModel = require('../models/statusLogs')
const { disableFacilityUsers, enableFacilityUsers } = require('../routes/facilityUser/helpers')
const { sendShiftConfirmationMail } = require('../services/facilityShiftConfirmation')
const { createDynamicShortLink , authMiddleware} = require('../../utils/firebase')
const {facilityProfileController}= require('./facilityProfile/facilityProfile.controller')

const router = express.Router()
const { ObjectId } = mongoose.Types

const getFacilityFilter = async (filter = {}) => {
  let facilityMatch = {
    userId: { $exists: true, $ne: null },
  }

  if (filter.status) {
    facilityMatch = {
      ...facilityMatch,
      status: filter.status
    }
  }

  if(filter.isSuspended === 'true') {
    facilityMatch = {
      ...facilityMatch,
      status: FacilityStatusObj.SUSPENDED
    }
  }

  if(filter.isCritical === 'true') {
    facilityMatch = {
      ...facilityMatch,
      isCritical: { $eq: true }
    }
  }

  if (!_.isEmpty(filter.users)) {
    facilityMatch = {
      userId: { $in: toArrayObjectIds(filter.users) },
    }
  }

  if (!_.isEmpty(filter.facilityId)) {
    console.log(filter)
    facilityMatch = {
      ...facilityMatch,
      userId: ObjectId(filter.facilityId),
    }
  }

  if (!_.isEmpty(filter.name)) {
    facilityMatch = {
      ...facilityMatch,
      name: new RegExp(filter.name, 'i'),
    }
  }

  if (!_.isEmpty(filter.email)) {
    facilityMatch = {
      ...facilityMatch,
      email: new RegExp(filter.email),
    }
  }

  if (!_.isEmpty(filter.phone)) {
    facilityMatch = {
      ...facilityMatch,
      phone: new RegExp(filter.phone),
    }
  }

  if (!_.isEmpty(filter.locations)) {
    facilityMatch.location = { $in: toArrayObjectIds(filter.locations) }
  }

  if (!_.isEmpty(filter.instantBook)) {
    if (filter.instantBook === 'ON') {
      facilityMatch.instantBook = true
    }
    if (filter.instantBook === 'OFF') {
      facilityMatch.instantBook = { $ne: true }
    }
  }

  if (!_.isEmpty(filter.facilityType)) {
    facilityMatch.type = { $eq: filter.facilityType }
  }

  return facilityMatch
}

router.get('/list', async (req, res) => {
  const { page = 1, filter, sorter, projection, getUserCount = false, optionalColumns } = req.query

  const facilityMatch = await getFacilityFilter(filter)

  let sort = { _id: 1 }

  if (!_.isEmpty(sorter)) {
    sort = {
      [sorter.field]: sorter.order === 'ascend' ? 1 : -1,
    }
  }

  const defaultProject = {
    userId: 1,
    email: 1,
    name: 1,
    phone: 1,
    createdAt: 1,
    location: 1,
    rates: 1,
    ratesTable: 1,
    qualifiedAgents: 1,
    requiredDocuments: 1,
    instantBook: 1,
    requirementCount: { $size: { $ifNull: ['$requiredDocuments', []] } },
    signatoryCount: { $size: { $ifNull: ['$authorizedSignatories', []] } },
    type: 1,
    lastLogAt: 1,
    rating: 1,
    isCritical: 1,
    status: 1,
  }

  let project = {}

  if (_.isEmpty(projection)) {
    project = defaultProject
  } else {
    _.forEach(projection, key => {
      project[key] = defaultProject[key]
    })
  }

  let aggregate = [
    {
      $match: facilityMatch,
    },
  ]

  if (getUserCount) {
    project = { ...project, userCount: { $size: '$facilityUsers' } }
    aggregate = [
      ...aggregate,
      {
        $lookup: {
          from: 'facilityusers',
          as: 'facilityUsers',
          let: { userId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$$userId', '$facility.userId'] },
                    { $ne: ['$archived', true] },
                  ],
                },
              },
            }
          ],
        },
      }
    ]
  }

  if (!_.isEmpty(optionalColumns)) {
    if (optionalColumns.includes('nurseAccountManager')) {
      project = { ...project, 'nurseAccountManager.email': 1 }
      aggregate = [
        ...aggregate,
        {
          $lookup: {
            from: 'employeeprofiles',
            localField: 'nurseAccountManager',
            foreignField: 'userId',
            as: 'nurseAccountManager'
          }
        },
        { $unwind: { path: '$nurseAccountManager', preserveNullAndEmptyArrays: true } },
      ]
    }

    if (optionalColumns.includes('customerSuccessManager')) {
      project = { ...project, 'customerSuccessManager.email': 1 }
      aggregate = [
        ...aggregate,
        {
          $lookup: {
            from: 'employeeprofiles',
            localField: 'customerSuccessManager',
            foreignField: 'userId',
            as: 'customerSuccessManager'
          }
        },
        { $unwind: { path: '$customerSuccessManager', preserveNullAndEmptyArrays: true } },
      ]
    }

    if (optionalColumns.includes('salesManager')) {
      project = { ...project, 'salesManager.email': 1 }
      aggregate = [
        ...aggregate,
        {
          $lookup: {
            from: 'employeeprofiles',
            localField: 'salesManager',
            foreignField: 'userId',
            as: 'salesManager'
          }
        },
        { $unwind: { path: '$salesManager', preserveNullAndEmptyArrays: true } },
      ]
    }
  }

  aggregate = [
    ...aggregate,
    {
      $project: project,
    },
    {
      $sort: sort,
    },
    {
      $skip: (page - 1) * 10,
    },
    {
      $limit: 10,
    }
  ]

  const facilities = await FacilityProfileModel.aggregate(aggregate)

  res.send(facilities)
})

router.get('/count', async (req, res, next) => {
  const { filter } = req.query

  const facilityMatch = await getFacilityFilter(filter)
  let facilityCount = await FacilityProfileModel.countDocuments(facilityMatch)

  res.send({ facilityCount })
})

router.get('/export', async (req, res, next) => {
  const { filter } = req.query

  const facilityMatch = await getFacilityFilter(filter)

  const facilities = await FacilityProfileModel.aggregate(
    [
      {
        $match: {
          ...facilityMatch
        }
      },
      {
        $sort: { _id: -1 }
      },
      {
        $lookup: {
          from: 'facilityusers',
          let: { facilityId: '$_id' },
          pipeline: [
            {
              $unwind: '$facilities',
            },
            {
              $match: {
                archived: false,
                $expr: { $eq: ['$facilities._id', '$$facilityId'] },
              }
            },
            {
              $project: {
                name: 1,
                email: 1,
                phone: 1,
                designation: 1,
                roles: 1,
                notify: 1,
                notes: 1,
              }
            }
          ],
          as: 'users',
        },
      },
      {
        $project: {
          userId: 1,
          name: 1,
          email: 1,
          phone: 1,
          fullAddress: 1,
          notes: 1,
          users: 1,
        }
      }
    ]
  )

  res.send(facilities)
})

/*
Request
{
  agentId: String
  ...data // fields in agentProfile Schema
}

Response
{
  ...Mongoose_document_update_result
}

Notes:
- Response Need to Standardize to {success, result}

*/
router.put('/put', async (req, res, next) => {
  let { facilityId, performedBy, ...data } = req.body

  const user = await UserModel.findOne({ _id: ObjectId(facilityId) })

  if (data.hasOwnProperty('requiredDocuments')) {
    data.requiredDocuments = data.requiredDocuments.map(id => ObjectId(id))
  }
  if (data.hasOwnProperty('location')) {
    data.location = ObjectId(data.location)
  }
  if (data.hasOwnProperty('nurseAccountManager')) {
    data.nurseAccountManager = ObjectId(data.nurseAccountManager)
  }
  if (data.hasOwnProperty('customerSuccessManager')) {
    data.customerSuccessManager = ObjectId(data.customerSuccessManager)
  }
  if (data.hasOwnProperty('phone')) {
    data.phone = data.phone.replace(/\D+/g, '')
  }

  const id = ObjectId(user.facility)

  const facility = await FacilityProfileModel.findById({ _id: id }, { qualifiedAgents: 1 })

  if (!facility.qualifiedAgents) {
    const defaultQualifiedReport = {
      qualified: {
        ...workerTypeDefaults,
        other: 0
      },
      potential: {
        ...workerTypeDefaults,
        other: 0
      },
    }

    data = {
      ...data,
      qualifiedAgents: defaultQualifiedReport,
    }
  }

  let fieldsForProfileChangeLogs = {}
  Object.keys(data).forEach(key => {
    fieldsForProfileChangeLogs[key] = 1
  })

  const result = await FacilityProfileModel.findOneAndUpdate(
    { _id: id },
    { $set: data },
    { new: false, fields: fieldsForProfileChangeLogs, runValidators: true }
  ).catch(next)

  logProfileChanges({
    performedBy,
    performedFor: facilityId,
    previousData: result,
    newData: data,
    userType: 'FACILITY',
  })
  
  if (
    data.hasOwnProperty('location') ||
    data.hasOwnProperty('requiredDocuments')
  ) {
    // Emits 'requirementsUpdated' event which is listened by different services
    // Eg: When requirementsUpdated is emitted, onboard time of an agent is updated
    serviceEvent.emit('requirementsUpdated', { facilityId: user._id })
  }

  if (data.hasOwnProperty('nurseAccountManager')) {
    serviceEvent.emit('updateNAM', { facilityId: user._id })
  }

  // Update Facility User Table
  let updateData = {}
  if (data.hasOwnProperty('name')) {
    updateData = { ...updateData, 'facilities.$.name': data.name }
  }
  if (data.hasOwnProperty('tmz')) {
    updateData = { ...updateData, tmz: data.tmz }
  }

  if (!_.isEmpty(updateData)) {
    updateFacilityUserOnFacilityProfileChange({ userInfo: updateData, facilityId: user._id })
  }

  updateZenFacility(data, facilityId)

  res.send(result)
})

const requestSignatureFromSignatory = async (req, facilityId, signatory) => {
  const { baseUrl } = meta()

  let signUrl=`${baseUrl}/signatorySign/${facilityId}/${signatory._id}`

  if (!baseUrl.includes('localhost')) {
    signUrl = await createDynamicShortLink(signUrl)
  }

  const body = `You've been added as an authorized signatory. Click the link to authorize. ${signUrl}`
  const toNumber = toPhoneNumber(signatory.phone)
  const opts = { signatoryId: signatory._id }
  sendSMS(body, meta().notify.from, toNumber, opts)

  sendRequestSignatureEmail(signUrl, signatory)
}

router.get('/authorizedSignatory', async (req, res, next) => {
  const { facilityId, signatoryId } = req.query

  const facility = await FacilityProfileModel.findOne(
    {
      userId: facilityId,
      'authorizedSignatories._id': signatoryId,
    },
    {
      userId: 1,
      name: 1,
      'authorizedSignatories.$': 1,
    }
  ).catch(next)

  res.send({ facility })
})

router.post('/newAuthorizedSignatory', async (req, res, next) => {
  let { facilityId, signatoryInfo, admin } = req.body

  const result = await FacilityProfileModel.findOneAndUpdate(
    {
      _id: ObjectId(facilityId),
    },
    {
      $push: {
        authorizedSignatories: {
          ...signatoryInfo,
          addedBy: admin,
        },
      },
    },
    {
      new: true,
      fields: { authorizedSignatories: 1, userId: 1 },
    }
  ).catch(next)

  const signatory = _.last(result.authorizedSignatories)

  logProfileChanges({
    performedBy: admin,
    performedFor: result.userId,
    updateType: UPDATE_TYPES.user,
    action: ACTIONS.added,
    newData: {
      signatory: signatoryInfo,
    },
    userType: 'FACILITY',
  })

  requestSignatureFromSignatory(req, result.userId, signatory)

  res.send(result)
})

router.post('/updateAuthorizedSignatory', async (req, res, next) => {
  let { facilityId, signatoryInfo, admin } = req.body

  const result = await FacilityProfileModel.findOneAndUpdate(
    {
      _id: ObjectId(facilityId),
      'authorizedSignatories._id': signatoryInfo._id,
    },
    {
      $set: {
        'authorizedSignatories.$.name': signatoryInfo.name,
        'authorizedSignatories.$.role': signatoryInfo.role,
        'authorizedSignatories.$.phone': signatoryInfo.phone,
        'authorizedSignatories.$.email': signatoryInfo.email,
        'authorizedSignatories.$.notes': signatoryInfo.notes,
      },
    },
    {
      new: false,
      fields: { authorizedSignatories: 1, userId: 1 },
    }
  ).catch(next)

  const [previousData] = result.authorizedSignatories.filter(signatory => signatory._id.toString() === signatoryInfo._id.toString())

  logProfileChanges({
    performedBy: admin,
    performedFor: result.userId,
    action: ACTIONS.updated,
    updateType: UPDATE_TYPES.user,
    previousData: {
      signatory: previousData,
    },
    newData: {
      signatory: signatoryInfo,
    },
  })

  res.send(result)
})

router.post('/updateAuthorizedSignature', async (req, res, next) => {
  let { facilityId, signatoryId, signature } = req.body

  const response = await uploadImage(signature, {
    folder: ImageFolders.SIGNATURE,
    tags: [ImageTags.SIGNATURE, ImageTags.AUTHORIZED_SIGNATORY],
    context: {
      signatoryId,
      facilityId,
    }
  })

  const uploadedSignature = {
    publicId: response.public_id,
    version: response.version,
    format: response.format,
  }

  const result = await FacilityProfileModel.findOneAndUpdate(
    {
      userId: facilityId,
      'authorizedSignatories._id': signatoryId,
    },
    {
      $set: {
        'authorizedSignatories.$.signature': uploadedSignature,
      },
    },
    {
      new: true,
      fields: { authorizedSignatories: 1 },
    }
  ).catch(next)

  const signatory = result.authorizedSignatories.find(
    ({ _id }) => signatoryId === _id.toString()
  )

  res.send({ signatory })
})

router.post('/requestAuthorizedSignature', async (req, res, next) => {
  const { facilityId, signatory } = req.body

  const { userId } = await FacilityProfileModel.findById(facilityId)

  requestSignatureFromSignatory(req, userId, signatory)

  res.send({ success: true })
})

router.post('/deleteAuthorizedSignatory', async (req, res, next) => {
  let { facilityId, signatoryId, performedBy } = req.body

  const result = await FacilityProfileModel.findOneAndUpdate(
    {
      _id: ObjectId(facilityId),
    },
    {
      $pull: {
        authorizedSignatories: {
          _id: signatoryId,
        },
      },
    },
    {
      new: false,
      fields: { authorizedSignatories: 1, userId: 1},
    }
  ).catch(next)

  const [signatory] = result.authorizedSignatories.filter(data => data._id.toString() === signatoryId.toString())

  logProfileChanges({
    performedBy,
    performedFor: result.userId,
    action: ACTIONS.removed,
    updateType: UPDATE_TYPES.user,
    newData: {
      signatory,
    },
  })

  res.send(result)
})

router.post('/address', async (req, res, next) => {
  const { session, address, location, performedBy } = req.body

  const facilityInfo = await FacilityProfileModel.findOneAndUpdate(
    {
      userId: ObjectId(session),
    },
    {
      $set: {
        fullAddress: address,
        geoLocation: {
          type: 'Point',
          coordinates: [location.lng, location.lat],
        },
      },
    },
    {
      new: false,
      fields: {
        address: 1,
        geoLocation: 1,
      },
    }
  )

  logProfileChanges({
    performedBy: req.userId || performedBy,
    performedFor: session,
    previousData: {
      address: facilityInfo.address.formatted,
    },
    newData: {
      address: address.formatted,
    },
    userType: 'FACILITY',
  })

  serviceEvent.emit('locationUpdated', { facilityId: session })
  serviceEvent.emit('updateNAM', { facilityId: session })

  res.send(facilityInfo)
})

router.put('/status', async (req, res, next) => {
  const { facilityId, reason, note, status } = req.body

  if (!FacilityStatus.includes(status)) {
    return next(httpError("Invalid status provided"))
  }
  if (!reason && [FacilityStatusObj.PROBATION, FacilityStatusObj.SUSPENDED, FacilityStatusObj.TERMINATED].includes(status)) {
    return next(httpError("Please provide reason"))
  }
  if ((reason === 'Other, please explain' || reason === 'Facility chose to Terminate') && !note) {
    return next(httpError("Note cannot be empty"))
  }
  const oldFacilityData = await FacilityProfileModel.findOneAndUpdate({
    userId: ObjectId(facilityId),
  },
    {
      $set: {
        status,
      }
    },
    {
      new: false
    }
  ).lean()
  if (status === FacilityStatusObj.TERMINATED) {
    disableFacilityUsers({ facilityId })
  } else if (oldFacilityData.status === FacilityStatusObj.TERMINATED) {
    enableFacilityUsers({ facilityId })
  }
  await FacilityStatusLogger({ ...req.body, currentStatus: status,
    previousStatus: oldFacilityData.status || FacilityStatusObj.ENROLLED })
  serviceEvent.emit('updateNAM', { facilityId })
  res.send({ suspension: 'Done' })
})

router.get('/status/logs', async (req, res) => {
  const logs = await StatusLogsModel
  .find({ facilityId: ObjectId(req.query.facilityId) })
  .sort({ _id: -1 })
  .lean()
  return res.send({ logs })
})

router.get('/salesowners/list', async (req, res) => {
  const saleManagerIds = await FacilityProfileModel.distinct('salesManager')
  let salesManagers = []
  if (saleManagerIds && saleManagerIds.length) {
    salesManagers = await UserModel.find({
      _id: { $in: saleManagerIds },
    }, [ 'email' ])
  }

  res.send({
    salesManagers,
  })
})

router.get('/status', async (req, res) => {
  const facilityStatuses = await FacilityProfileModel.aggregate([
    {
      $project: {
        _id: 1,
        status: 1
      }
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ])
  const statuses = facilityStatuses.reduce((obj, item) => (obj[item._id] = item.count, obj), {})
  return res.send({ statuses })
})

router.get('/sendShiftConfirmationMails', async (req, res) => {
  sendShiftConfirmationMail()
  res.send({ status: 'success' })
})

router.get('/details', async (req, res) => {
  let facilityIds = []
  if(req.query.facilityIds){
    facilityIds = req.query.facilityIds.replace(/ /g, '').split(',')
  }
  const projection = (req.query.projection || '').replace(/,/g, ' ')
  const facilities = await FacilityProfileModel.find(
    { userId: { $in: facilityIds } },
  ).select(projection).lean()
  return res.send(facilities)
})

router.get('/excludedAgents', async (req, res) => {
  const { facilityId } = req.query

  const exclusions = await ExclusionModel.find({ facility: ObjectId(facilityId), archived: { $ne: true } })

  const blockedAgents = exclusions.map(exclusion => exclusion.agent)

  res.send({ blockedAgents })
})

router.get('/:id', authMiddleware(),async (req,res,next)=>{

  const facilityId = req.params.id
  const projectionFields = {
    _id :1,
    userId:1,
    email:1,
    name:1,
    phone:1,
    note:1,
    tmz:1,
    authorizedSignatories:1,
    requireTimecardPhoto:1,
    location:1,
    rates:1,
    state:'$fullAddress.state',
    isCritical:1,
    shiftVerificationInstructions:1,
    shiftConfirmationInstructions:1,
    geoLocation:1,
  }

  const facilityInfo = await FacilityProfileModel.findOne({userId:facilityId},projectionFields)
  if (!facilityInfo) {
    return next(httpError('requested facility does not exist', 404))
  }
  res.send({facilityInfo})


})
facilityProfileController(router)

module.exports = router
