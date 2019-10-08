import shortid from 'shortid'
import GoogleAnalyzedEntity from './GoogleAnalyzedEntity'
import extractTextFromDraftString from 'parabol-client/utils/draftjs/extractTextFromDraftString'

export interface ReflectionInput {
  id?: string
  createdAt?: Date
  creatorId: string
  content: string
  plaintextContent?: string // the plaintext version of content
  entities: GoogleAnalyzedEntity[]
  meetingId: string
  reflectionGroupId?: string
  retroPhaseItemId: string
  sortOrder?: number
  updatedAt?: Date
}

export default class Reflection {
  id: string
  autoReflectionGroupId?: string
  createdAt: Date
  creatorId: string
  content: string
  plaintextContent: string
  entities: GoogleAnalyzedEntity[]
  isActive: boolean
  meetingId: string
  reflectionGroupId: string
  retroPhaseItemId: string
  sortOrder: number
  updatedAt: Date
  constructor(input: ReflectionInput) {
    const {content, plaintextContent, createdAt, creatorId, entities, id, meetingId, reflectionGroupId, retroPhaseItemId, sortOrder, updatedAt} = input
    const now = new Date()
    this.id = id || shortid.generate()
    this.createdAt = createdAt || now
    this.creatorId = creatorId
    this.content = content
    this.plaintextContent = plaintextContent || extractTextFromDraftString(content)
    this.entities = entities
    this.isActive = true
    this.meetingId = meetingId
    this.reflectionGroupId = reflectionGroupId || shortid.generate()
    this.retroPhaseItemId = retroPhaseItemId
    this.sortOrder = sortOrder || 0
    this.updatedAt = updatedAt || now
  }
}