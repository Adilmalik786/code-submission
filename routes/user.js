const express = require('express')
const mongoose = require('mongoose')
const _ = require('lodash')

const { httpError } = require('../../utils/errors')
const CandidateModel = require('../models/candidate')
const UserModel = require('../models/user')
const AgentModel = require('../models/agentProfile')
const FacilityModel = require('../models/facilityProfile')
const { pipelineFacilities } = require('../helpers/user')
const EmployeeModel = require('../models/employeeProfile')
const { sendOnboardingEmail, sendCandidateEmail, sendSignInLinkEmail } = require('../../utils/email')
const { sendWelcomeText, sendSMS } = require('../../utils/sms')
const { getApplyLink, fullNameToFirstLast } = require('../../utils/strings')
const meta = require('../../utils/meta')
const { createUser } = require('../services/dailyPay')
const { createZenFacility, updateZenFacility } = require('../services/zenDesk/facility')
const { createZenAgent, updateZenAgent } = require('../services/zenDesk/agent')
const { handleNewAgent, handleUpdateAgent, updateAgentClaims, updateAgentFirebaseUid } = require('../services/firebase')
const { shiftActivityLogger: adminActivityLogger } = require('../../utils/adminActivityLogger')
const { updateFacilityUserOnFacilityProfileChange } = require('./facilityUser/helpers')
const { FacilityStatusObj } = require('../../utils/facility')
const { logProfileChanges } = require('../../utils/profileChangeLogger')
const { WORKER_STAGES_ENUM } = require('../../utils/worker')
const { serviceEvent } = require('../events')
const { getLinkForMobileAppSigningIn } = require('../services/firebase')

const ObjectId = mongoose.Types.ObjectId
const router = express.Router()

/*
  Route List:
    post('/create')   // signgs up user
    post('/login')    // logs user in, maybe don't store password in clear text at some point
                          but good for testing right now
    post('/password') // Should reroute to put('/put'), unless requiring old password
    post('/flags')    // Should reroute to put('/put')
    put('put')        // Updates fields
    get('/get/:id')   // retrieves user with profile info populated (agency or facility)
    get('/list')      // lists users without password info, not yet queryable

  Notes
    - Move to put('/put') route
*/

router.post('/create', async (req, res, next) => {
  let check = await UserModel.findOne({ email: req.body.email.toLowerCase().trim() })
  let user
  if (check && !(req.body.type === 'FACILITY' && check.type === 'FACILITY')) {
    return next(httpError('Email address already in use', 500))
  }

  const objectId = String(mongoose.Types.ObjectId())

  if (req.body.hasOwnProperty('phone')) {
    req.body.phone = _.replace(req.body.phone, /\D+/g, '')
  }

  // create the required agentProfile or facilityProfile and link it to user
  if (req.body.type === 'AGENT') {
    const agentParams = {
      ...req.body,
      userId: objectId,
      type: undefined,
      checkrSent: req.body.selfOnboarded ? false : null,
      ripplingSent: req.body.selfOnboarded ? false: null,
      welcomeSent: req.body.selfOnboarded ? false : null,
      active: true,
      isFirstSession: true
    }

    if (agentParams.firstName || agentParams.lastName) {
      agentParams.name = `${agentParams.firstName.trim()} ${agentParams.lastName.trim()}`
    } else if (agentParams.name) {
      const { firstName, lastName } = fullNameToFirstLast(agentParams.name)
      agentParams.firstName = firstName
      agentParams.lastName = lastName
    }

    const _id = String(mongoose.Types.ObjectId())

    // serviceEvent.emit('newAgent', { _id, ...agentParams })
    const result = await handleNewAgent({ _id, ...agentParams })
      .catch(err => next(httpError(err, 500)))

    if (!result.uid) {
      return next(httpError(result, 500))
    }

    user = await UserModel.create({ _id: objectId, ...req.body}).catch(() => {
      return next(httpError('Registration failed', 500))
    })

    const agent = await AgentModel.create({ _id, ...agentParams })
    .catch(() => next(httpError('Agent creation failed', 500)))

    serviceEvent.emit('agentAdded', user._id)
    adminActivityLogger('HIRE', agentParams.addedBy, null, agentParams.userId, null)

    user.agent = agent

    agent.tmz = user.tmz

    await updateAgentClaims(result.uid, { userId: agentParams.userId, tmz: agentParams.tmz })

    await updateAgentFirebaseUid({ uid: result.uid, userId: agent.userId })

    const userParams = {
      agent: agent._id,
      addedBy: req.body.selfOnboarded ? user._id : req.body.addedBy,
    }
    await UserModel.update(
      { _id: ObjectId(user._id) }, { $set: userParams }
    )

    await CandidateModel.update(
      { email: req.body.email.toLowerCase(), user: { $exists: 0 } },
      { $set: { user: user._id } }
    )

    const userInfo = {
      _id: user._id,
      agentId: agent._id,
      email: user.email,
      phone: agent.phone,
      firstName: agent.firstName,
      lastName: agent.lastName,
    }

    createUser(userInfo)

    createZenAgent(user._id)
  }

  if (req.body.type === 'FACILITY') {
    user = await UserModel.create(req.body).catch(() => {
      return next(httpError('Registration failed', 500))
    })
    const facility = await FacilityModel.create({ ...req.body, type: undefined, userId: user._id })
      .catch(() => next(httpError('Facility creation failed', 500)))

    await UserModel.update(
      { _id: ObjectId(user._id) }, { $set: { facility: facility._id } }
    )
    user.facility = facility

    createZenFacility(user._id)
  }

  res.send(user)
})

router.post('/welcome', async (req, res, next) => {
  const { userId } = req.body
  const user = await UserModel.findOne({ _id: ObjectId(userId) }).populate('agent')
  if (!user || !user.agent) {
    return next(httpError(`Could not locate agent ${userId}`, 404))
  }

  sendOnboardingEmail(ObjectId(userId))
  sendWelcomeText(user)

  await AgentModel.updateOne(
    { _id: ObjectId(user.agent._id) }, { $set: { welcomeSent: true } }
  )

  res.sendStatus(202)
})

router.post('/login', async (req, res, next) => {
  const { email, password } = req.body

  const user = await UserModel.findOne({
    email: email.toLowerCase()
  }).populate('employee').lean()

  if (!user || user.type !== 'ADMIN') {
    return next(httpError('User not found', 404))
  }
  if (user.password !== password) {
    return next(httpError('Incorrect password', 400))
  }

  delete user.password
  res.send(user)
})

router.post('/sendSignInLink', async (req, res, next) => {
  const { email } = req.body

  const user = await UserModel.findOne({
    email: email.toLowerCase(),
  })
    .populate('facility')
    .populate('agent')

  if (!user) {
    return next(httpError('Email not found', 404))
  }

  const baseUrl = `https://${req.hostname}`

  sendSignInLinkEmail(user, baseUrl)

  res.send({ success: true })
})

router.post('/password', async (req, res) => {
  const result = await UserModel.update({ _id: req.body.userId}, { $set: { 'password' : req.body.new }})
  res.send(result)
})

router.post('/flags', async (req, res) => {
  const { flagInfo, userId } = req.body

  const result = await UserModel.update({ _id: userId }, { $set: { [`flags.${flagInfo.key}`] : flagInfo.value }})

  res.send(result)
})

const updateProfile = async (userId, updateInfo, performedBy) => {
  const facilityResult = await FacilityModel.findOneAndUpdate({ userId }, { $set: updateInfo}, { new: false })
  if (facilityResult) {
    if (facilityResult) {
      logProfileChanges({
        performedBy,
        performedFor: userId,
        previousData: facilityResult,
        newData: updateInfo,
        userType: 'FACILITY'
      })
    }
  }
  const agentResult = await AgentModel.findOneAndUpdate({ userId }, { $set: updateInfo}, { new: false, fields: { tmz: 1 } })
  if (agentResult) {
    logProfileChanges({
      performedBy,
      performedFor: userId,
      previousData: agentResult,
      newData: updateInfo,
      userType: 'AGENT'
    })
  }
}

router.put('/put', async (req, res, next) => {
  const { id, performedBy, ...data } = req.body
  const foundUser = await UserModel.findById({ _id: ObjectId(id) }).catch(next)

  if (data.hasOwnProperty('email')) {
    updateProfile(id, { email: data.email }, performedBy)
  }

  if (data.hasOwnProperty('tmz')) {
    updateProfile(id, { tmz: data.tmz }, performedBy)
  }

  if (foundUser.type === 'AGENT') {
    const updatedAgent = await handleUpdateAgent({ data, userId: id })
    if (!updatedAgent.uid) {
      return next(httpError(updatedAgent, 500))
    }

    if (data.tmz) {
      updateAgentClaims(updatedAgent.uid, { ...data, userId: foundUser._id })
    }

    updateZenAgent(data, id)
  }

  if (foundUser.type === 'FACILITY') {
    if (data.hasOwnProperty('tmz')) {
      updateFacilityUserOnFacilityProfileChange({ userInfo: { tmz: data.tmz }, facilityId: foundUser._id })
    }
    updateZenFacility(data, id)
  }

  const result = await UserModel.findOneAndUpdate(
    { _id: ObjectId(id) },
    { $set: data },
    { new: true, runValidators: true, fields: { type: 1 } }
  ).catch(next)

  res.send(result)
})

router.get('/get/:id', async (req, res, next) => {
  const { id } = req.params

  const user = await UserModel.findOne({ _id: id }, { password: 0 }).lean()
  if (!user) {
    return next(httpError('requested user does not exist', 404))
  }

  if (user.type === 'AGENT') {
    user.agent = await AgentModel.findOne({ _id: user.agent })
  } else if (user.type === 'FACILITY') {
    user.facility = await FacilityModel.findOne({ _id: user.facility })
  } else if (user.type === 'ADMIN') {
    user.employee = await EmployeeModel.findOne({ _id: user.employee })
  }
  res.send(user)
})

router.get('/active/:id', async (req,res) => {
  let { deactivated } = await UserModel.findOne({ _id: req.params.id }, {deactivated: 1})
  res.send( {active: !deactivated} )
})

router.get('/admins', async (req, res) => {
  let admins = await UserModel.find(
    { type: 'ADMIN', deactivated: { $ne: true } },
    { email: 1 }
  )
  res.send(admins)
})

router.get('/facilities', async (req, res) => {
  const facilities = await pipelineFacilities({})
  res.send(facilities)
})

router.post('/candidate', async (req, res, next) => {

  let check = await CandidateModel.findOne({ email: req.body.email.toLowerCase() })
    .catch(err => next(httpError('Candidate check failed: ' + err, 500)))

  if (check) {
    return next(httpError('Candidate with that email already exists', 400))
  }

  const candidate = await CandidateModel.create(req.body)
    .catch(err => next(httpError('Create Candidate failed: ' + err, 500)))

  welcomeCandidate(req.body.email, req.body.name, req.body.phone, req.body.location, req.body.qualification)

  res.send(candidate)
})

router.get('/accountCount', async (req, res) => {
  let { name } = req.query

  name = new RegExp(name, 'i')

  const agentCount = await AgentModel.countDocuments({
    name,
    userId: { $exists: true },
    stage: { $ne: WORKER_STAGES_ENUM.TERMINATED },
  })

  const facilityCount = await FacilityModel.countDocuments({
    name,
    userId: { $exists: true },
    status: { $ne : FacilityStatusObj.TERMINATED }
  })

  res.send({
    agentCount,
    facilityCount,
  })
})

router.get('/accountList', async (req, res) => {

  let { name } = req.query

  name = new RegExp(name, 'i')

  const agentList = await AgentModel.find({
    name,
    userId: { $exists: true },
    stage: { $ne: WORKER_STAGES_ENUM.TERMINATED },
  }, {
    name: 1,
    userId: 1,
  }, {
    limit: 5
  })

  const facilityList = await FacilityModel.find({
    name,
    userId: { $exists: true },
    status: { $ne: FacilityStatusObj.TERMINATED },
  }, {
    name: 1,
    userId: 1,
  }, {
    limit: 5
  })

  res.send({
    agentList,
    facilityList,
  })
})


router.get('/agentList', async (req, res) => {

  let { userIds } = req.query

  let agentMatch = {
    type: 'AGENT',
    deactivated: { $ne: true }
  }

  if (userIds) {
    userIds = Array.isArray(userIds) ? userIds : [userIds]
    agentMatch = {
      _id: { $in: userIds.map(ObjectId) }
    }
  }

  const agentList = await UserModel.aggregate([
    {
      $match: agentMatch,
    },
    {
      $lookup: {
        from: 'agentprofiles',
        localField: 'agent',
        foreignField: '_id',
        as: 'agent'
      },
    },
    {
      $unwind: {
        path: '$agent'
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'addedBy',
        foreignField: '_id',
        as: 'addedBy'
      }
    },
    {
      $unwind: {
        path: '$addedBy',
        preserveNullAndEmptyArrays: true
      },
    },
    {	
      $unwind: {	
        path: '$agent.locations',	
        preserveNullAndEmptyArrays: true	
      }	
    },
    {
      $lookup: {
        from: 'locations',
        localField: 'agent.locations',
        foreignField: '_id',
        as: 'locations'
      }
    },
    {
      $unwind: {
        path: '$locations',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$_id',
        email: { $first: '$email' },
        tmz: { $first: '$tmz' },
        flags: { $first: '$flags' },
        createdAt: { $first: '$createdAt' },
        agent: { $first: '$agent' },
        locations: { $push: '$locations' },
        addedBy: { $first: '$addedBy' },
        zenDeskId: { $first: '$zenDeskId' },
      }
    },
  ]).allowDiskUse(true)
  res.send({
    agentList
  })
})

router.get('/checkIfEmailExists', async (req, res) => {
  let check = await UserModel.findOne({ email: req.query.email.toLowerCase().trim() })
  if (check) {
    return res.send({ exists: true })
  } else {
    return res.send({ exists: false })
  }
})

router.get('/signInEmailLink', async (req, res, next) => {
 try {
    const { email, appDomain } = req.query
    const link = await getLinkForMobileAppSigningIn(email, appDomain)
    res.send({ link })
  } catch (error) {
    if (error.message.includes('USER_DISABLED')) {
      return next(httpError('User Deactivated', 400))
    }
    return next(httpError(error.message))
  }
}) 

function welcomeCandidate(email, name, phone, location, qualification) {
    // send welcome email + text
  const toNumber = `+1${phone.replace( /^\D+/g, '')}`
  const body = `Welcome to Clipboard Health, ${name}! Get started here: ${getApplyLink(location, qualification)}`
  sendSMS(body, meta().notify.from, toNumber, {})

  sendCandidateEmail(email, name, location, qualification)
}

module.exports = router
