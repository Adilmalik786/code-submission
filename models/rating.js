const mongoose = require('mongoose')

const schemaName = 'Rating'

const { Schema, model } = mongoose
const { ObjectId } = Schema.Types

const schema = new Schema(
  {
    facility: {
      userId: ObjectId,
      name: String,
    },
    agent: {
      userId: ObjectId,
      name: String,
    },
    shift: {
      _id: ObjectId,
      start: Date,
      name: String,
      agentReq: String,
    },
    reviewFor: { type: String, enum: ['AGENT', 'FACILITY'] },
    rating: { type: Number, min: 1, max: 5 },
    reasons: [String],
    otherReason: { type: String, trim: true },
    review: { type: String, trim: true },
    reviewedBy: ObjectId,
  },
  {
    timestamps: true,
  }
)

schema.index({ reviewFor: 1, 'agent.userId': 1 })
schema.index({ reviewFor: 1, 'facility.userId': 1 })

module.exports = model(schemaName, schema)
