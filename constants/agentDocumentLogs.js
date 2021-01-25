const agentDocumentActionsMap = {
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_UPDATED: 'DOCUMENT_UPDATED',
  DOCUMENT_DELETED: 'DOCUMENT_DELETED',
}

const agentDocumentActions = [
  agentDocumentActionsMap.DOCUMENT_UPLOADED,
  agentDocumentActionsMap.DOCUMENT_UPDATED,
  agentDocumentActionsMap.DOCUMENT_DELETED,
]

const documentUpdatedTypes = {
  LABEL_CHANGED: 'LABEL_CHANGED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
  VISIBLE_CHANGED: 'VISIBLE_CHANGED',
  OTHER_CHANGES: 'OTHER_CHANGES'
}

const statusToUpdatedTypeMap = {
  pending: documentUpdatedTypes.PENDING,
  approved: documentUpdatedTypes.APPROVED,
  rejected: documentUpdatedTypes.REJECTED,
}

const fieldToUpdatedTypeMap = {
  displayName: documentUpdatedTypes.LABEL_CHANGED,
  isHidden: documentUpdatedTypes.VISIBLE_CHANGED,
  other: documentUpdatedTypes.OTHER_CHANGES
}

const documentUpdatedTypesList = [
  documentUpdatedTypes.LABEL_CHANGED,
  documentUpdatedTypes.APPROVED,
  documentUpdatedTypes.REJECTED,
  documentUpdatedTypes.PENDING,
  documentUpdatedTypes.VISIBLE_CHANGED,
  documentUpdatedTypes.OTHER_CHANGES,
]

module.exports = {
  agentDocumentActionsMap,
  agentDocumentActions,
  documentUpdatedTypes,
  documentUpdatedTypesList,
  statusToUpdatedTypeMap,
  fieldToUpdatedTypeMap,
}
