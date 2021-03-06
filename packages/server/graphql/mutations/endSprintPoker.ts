import {GraphQLID, GraphQLNonNull} from 'graphql'
import {SubscriptionChannel} from 'parabol-client/types/constEnums'
import {NewMeetingPhaseTypeEnum} from 'parabol-client/types/graphql'
import getMeetingPhase from 'parabol-client/utils/getMeetingPhase'
import findStageById from 'parabol-client/utils/meetings/findStageById'
import getRethink from '../../database/rethinkDriver'
import Meeting from '../../database/types/Meeting'
import MeetingPoker from '../../database/types/MeetingPoker'
import TimelineEventPokerComplete from '../../database/types/TimelineEventPokerComplete'
import {getUserId, isSuperUser, isTeamMember} from '../../utils/authorization'
import getRedis from '../../utils/getRedis'
import publish from '../../utils/publish'
import segmentIo from '../../utils/segmentIo'
import standardError from '../../utils/standardError'
import {GQLContext} from '../graphql'
import EndSprintPokerPayload from '../types/EndSprintPokerPayload'
import sendNewMeetingSummary from './helpers/endMeeting/sendNewMeetingSummary'
import {endSlackMeeting} from './helpers/notifySlack'
import removeEmptyTasks from './helpers/removeEmptyTasks'

export default {
  type: GraphQLNonNull(EndSprintPokerPayload),
  description: 'Finish a sprint poker meeting',
  args: {
    meetingId: {
      type: GraphQLNonNull(GraphQLID),
      description: 'The meeting to end'
    }
  },
  async resolve(_source, {meetingId}, context: GQLContext) {
    const {authToken, socketId: mutatorId, dataLoader} = context
    const r = await getRethink()
    const operationId = dataLoader.share()
    const subOptions = {mutatorId, operationId}
    const now = new Date()
    const viewerId = getUserId(authToken)

    // AUTH
    const meeting = (await r
      .table('NewMeeting')
      .get(meetingId)
      .default(null)
      .run()) as Meeting | null
    if (!meeting) return standardError(new Error('Meeting not found'), {userId: viewerId})
    const {endedAt, facilitatorStageId, meetingNumber, phases, teamId, meetingType} = meeting

    // VALIDATION
    if (!isTeamMember(authToken, teamId) && !isSuperUser(authToken)) {
      return standardError(new Error('Not on team'), {userId: viewerId})
    }
    if (endedAt) return standardError(new Error('Meeting already ended'), {userId: viewerId})

    // RESOLUTION
    // remove hovering data from redis
    const estimatePhase = phases.find(
      (phase) => phase.phaseType === NewMeetingPhaseTypeEnum.ESTIMATE
    )!
    const {stages: estimateStages} = estimatePhase
    const redisKeys = estimateStages.map((stage) => `pokerHover:${stage.id}`)
    const redis = getRedis()
    // no need to await
    redis.del(...redisKeys)

    const currentStageRes = findStageById(phases, facilitatorStageId)
    if (!currentStageRes) {
      return standardError(new Error('Cannot find facilitator stage'), {userId: viewerId})
    }
    const {stage} = currentStageRes
    const phase = getMeetingPhase(phases)
    stage.isComplete = true
    stage.endAt = now

    const completedMeeting = ((await r
      .table('NewMeeting')
      .get(meetingId)
      .update(
        {
          endedAt: now,
          phases
        },
        {returnChanges: true}
      )('changes')(0)('new_val')
      .run()) as unknown) as MeetingPoker
    const {facilitatorUserId, templateId} = completedMeeting
    const [meetingMembers, team, removedTaskIds, meetingTemplateName] = await Promise.all([
      dataLoader.get('meetingMembersByMeetingId').load(meetingId),
      dataLoader.get('teams').load(teamId),
      removeEmptyTasks(meetingId),
      dataLoader.get('meetingTemplates').load(templateId)
    ])
    const presentMembers = meetingMembers.filter(
      (meetingMember) => meetingMember.isCheckedIn === true
    )
    const presentMemberUserIds = presentMembers.map(({userId}) => userId)
    endSlackMeeting(meetingId, teamId, dataLoader).catch(console.log)
    presentMemberUserIds.forEach((userId) => {
      const wasFacilitator = userId === facilitatorUserId
      segmentIo.track({
        userId,
        event: 'Meeting Completed',
        properties: {
          hasIcebreaker: phases[0].phaseType === NewMeetingPhaseTypeEnum.checkin,
          // include wasFacilitator as a flag to handle 1 per meeting
          wasFacilitator,
          userIds: wasFacilitator ? presentMemberUserIds : undefined,
          meetingType,
          meetingTemplateName,
          meetingNumber,
          teamMembersCount: meetingMembers.length,
          teamMembersPresentCount: presentMembers.length,
          teamId
        }
      })
    })
    sendNewMeetingSummary(completedMeeting, context).catch(console.log)

    const events = meetingMembers.map(
      (meetingMember) =>
        new TimelineEventPokerComplete({
          userId: meetingMember.userId,
          teamId,
          orgId: team.orgId,
          meetingId
        })
    )
    await r
      .table('TimelineEvent')
      .insert(events)
      .run()

    const data = {
      meetingId,
      teamId,
      isKill: phase.phaseType !== 'ESTIMATE',
      removedTaskIds
    }
    publish(SubscriptionChannel.TEAM, teamId, 'EndSprintPokerSuccess', data, subOptions)

    return data
  }
}
