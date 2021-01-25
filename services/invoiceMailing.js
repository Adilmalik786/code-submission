const { CronJob } = require('cron')
const mongoose = require('mongoose')
var Mailgun = require('mailgun-js')
const Model = require('../models/message')
const moment = require('moment-timezone')
const _ = require('lodash')

const InvoiceModel = require('../models/invoice')
const FacilityUserModel = require('../models/facilityUser')
const MailingQueueModel = require('../models/mailingQueue')

const meta = require('../../utils/meta')
const logger = require('../../utils/logger')
const {
  getInvoiceHtml,
  getTimesheetHtml,
} = require('../../utils/strings')
const {
  extractEmailsFromText,
  convertToDevEmail
} = require('../../utils/email')

const { Html2PDF } = require('../../utils/pdfGenerator')

const cloudinary = require('cloudinary').v2

const ObjectId = mongoose.Types.ObjectId

const { cloudName, apiKey, apiSecret } = meta().cloudinary
const { supportEmail } = meta()

cloudinary.config({ 
  cloud_name: cloudName, 
  api_key: apiKey, 
  api_secret: apiSecret,
  secure: true,
})


// TODO: put these in env vars
const mailgun = new Mailgun({
  apiKey: 'bddb036f1a395f790f0232823a46b40b-6b60e603-0a538307',
  domain: 'clipboardhealth.com'
})

const InvoiceMailingService = () => {
  const everyNminutes = '*/1 * * * *'

  const cronOptions = {
    cronTime: everyNminutes,
    onTick: clearInvoiceMailingQueue,
    start: true,
  }
  new CronJob(cronOptions)
}

const clearInvoiceMailingQueue = async () => {
  
  MailingQueueModel.findOne({}, {}, { sort: { 'created_at' : -1 } }, async (err, queueItem) => {

    if(err){
      logger.error(`Error querying invoice mailing queue: ${err}`)
      return
    }

    if (!queueItem) {
      return
    }

    const invoice = JSON.parse(queueItem.invoice)
    const appUrl = queueItem.appUrl

    let invoiceEmails = []

    if (invoice.facilityId.email) {
      // protect from poorly formed email data e.g. "xx@gmail.com & yy@gmail.com"
      invoiceEmails = [
        ...invoiceEmails,
        ...extractEmailsFromText(invoice.facilityId.email)
      ]
    }

    const facilityUserId = ObjectId(invoice.facilityId._id)

    const facilityUsers = await FacilityUserModel.find({
      'facilities.userId': facilityUserId,
      'notify.EMAIL.INV_EMAIL': true,
      'archived': { $ne: true },
    },
    {
      email: 1,
    })

    facilityUsers.forEach(({email}) => {
      invoiceEmails.push(email)
    })

    invoiceEmails = _.uniq(invoiceEmails)

    if(queueItem.sendAll){
      // Send invoice
      const pdfInvoice = await Html2PDF(invoice._id, appUrl)
      const pdfTimesheet = await Html2PDF(invoice._id, appUrl, 'timesheet')

      try {
        await cloudinary.uploader.upload_stream({
          public_id: `invoice-${invoice._id}`,
          use_filename: true,
          resource_type: 'auto'
        }, async (error) => {
          if(error){
            logger.error(error)
            return
          }
        
          await cloudinary.uploader.upload_stream({
            public_id: `timesheet-${invoice._id}`,
            use_filename: true,
            resource_type: 'auto'
          }, async (error) => {
            if(error){
              logger.error(error)
              return
            }
            const path = (meta().app)[0]
            const invoiceLink = `${path}/admin/invoice/${invoice._id}`
            const timeSheetLink = `${path}/timesheet/${invoice._id}`
            const EmailParams = {
              subject: `${invoice.facilityId.facility.name} Invoice # ${invoice.count} | ${moment(invoice.createdAt).format('MMMM Do YYYY')}`,
              html: getInvoiceHtml(invoice, invoice.facilityId.facility, invoiceLink, timeSheetLink),
              cc: 'billing@clipboardhealth.com',
              to: invoiceEmails.join(','),
              attachment: [
                new mailgun.Attachment({data: pdfInvoice, filename: `invoice-${invoice._id}.pdf`}),
                new mailgun.Attachment({data: pdfTimesheet, filename: `timesheet-${invoice._id}.pdf`})
              ]
            }
            sendEmail(EmailParams, queueItem._id)

            InvoiceModel.updateOne({ _id: invoice._id }, { $set: { sentAt: new Date().toISOString() }}, () => {}) 

          })
          .end(pdfTimesheet)

        })
        .end(pdfInvoice)
      } catch (error) {
        logger.error(`Error uploading to cloudinary: ${error}`)
      }
    } else {
      // Send Timesheet only
      let invoicePeriod = ''
      const dateFormat ='MMMM Do YYYY'
  
      if (invoice.period) {
        invoicePeriod = `${moment(invoice.period.start).format(dateFormat)} - ${moment(invoice.period.end).format(dateFormat)}`
      } else {
        invoicePeriod = `${moment(invoice.start).format(dateFormat)} - ${moment(invoice.end).format(dateFormat)}`
      }

      const pdfTimesheet = await Html2PDF(invoice._id, appUrl, 'timesheet')

      try {

        await cloudinary.uploader.upload_stream({
          public_id: `timesheet-${invoice._id}`,
          use_filename: true,
          resource_type: 'auto',
          overwrite: false
        }, async (error, uploadedTimesheet) => {
          if(error){
            logger.error(error)
            return
          }

          const EmailParams = {
            subject: `Timesheet for invoice # ${invoice.count} | ${invoicePeriod}`,
            html: getTimesheetHtml(invoice, invoicePeriod, uploadedTimesheet.url),
            cc: 'billing@clipboardhealth.com',
            to: invoiceEmails.join(','),
            attachment: [
              new mailgun.Attachment({data: pdfTimesheet, filename: `timesheet-${invoice._id}.pdf`})
            ]
          }
          sendEmail(EmailParams, queueItem._id)

          InvoiceModel.updateOne({ _id: invoice._id }, { $set: { sentAt: new Date().toISOString() }}, () => {}) 
          
        })
        .end(pdfTimesheet)

      } catch (error) {
        logger.error(`Error uploading to cloudinary: ${error}`)
      }

    }

  })
  
}


const sendEmail = (params, queueItemId) => {
  if (!(params.to && params.subject && (params.text || params.html))) {
    logger.error('Must include a "to" address, a "subject", and either "text" or "html"')
    return
  }
  if (!params.from) {
    params.from = supportEmail
  }

  const { email, dev } = meta()

  params = {
    ...params,
    ...email.overrideParams
  }

  if (dev) {
    params.to = convertToDevEmail(params.to)
    params.cc = convertToDevEmail(params.cc)
  }

  logger.debug(`sendEmail: ${JSON.stringify(params)}`)

  mailgun.messages().send(params, function (err) {
    if (err) {
      const info = _.omit(params, ['html'])
      logger.error(`sendEmail: ${err} ${JSON.stringify(info)}`)
    } else {
      Model.create({
        message: params.text || params.html,
        from: params.from,
        to: params.to,
        agentId: params.agentId, // this is null or ObjectId
        shiftId: params.shiftId, // this is null or ObjectId
        method: 'EMAIL'
      }, (err) => {
        if(err){
          logger.error(`Error adding mail to Mailgun queue: ${err}`)
          return
        }
        MailingQueueModel.findByIdAndDelete({_id: queueItemId}, (err)=>{
          if(err){
            logger.error(`Error deleting queue item: ${err}`)
            return
          }
        })
      })
    }
  })
}

module.exports = { InvoiceMailingService }
