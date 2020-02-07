import crypto from 'crypto'
import promisify from 'es6-promisify'
import {GraphQLID, GraphQLList, GraphQLNonNull} from 'graphql'
import {SubscriptionChannel} from 'parabol-client/types/constEnums'
import {SuggestedActionTypeEnum} from 'parabol-client/types/graphql'
import getRethink from '../../database/rethinkDriver'
import NotificationTeamInvitation from '../../database/types/NotificationTeamInvitation'
import TeamInvitation from '../../database/types/TeamInvitation'
import sendEmailPromise from '../../email/sendEmail'
import removeSuggestedAction from '../../safeMutations/removeSuggestedAction'
import {getUserId, isTeamMember} from '../../utils/authorization'
import getBestInvitationMeeting from '../../utils/getBestInvitationMeeting'
import makeAppLink from '../../utils/makeAppLink'
import publish from '../../utils/publish'
import sendSegmentEvent from '../../utils/sendSegmentEvent'
import {TEAM_INVITATION_LIFESPAN} from '../../utils/serverConstants'
import standardError from '../../utils/standardError'
import rateLimit from '../rateLimit'
import GraphQLEmailType from '../types/GraphQLEmailType'
import InviteToTeamPayload from '../types/InviteToTeamPayload'

const randomBytes = promisify(crypto.randomBytes, crypto)

export default {
  type: new GraphQLNonNull(InviteToTeamPayload),
  description: 'Send a team invitation to an email address',
  args: {
    meetingId: {
      type: GraphQLID,
      description: 'the specific meeting where the invite occurred, if any'
    },
    teamId: {
      type: new GraphQLNonNull(GraphQLID),
      description: 'The id of the inviting team'
    },
    invitees: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLEmailType)))
    }
  },
  resolve: rateLimit({perMinute: 10, perHour: 100})(
    async (
      _source,
      {invitees, meetingId, teamId},
      {authToken, dataLoader, socketId: mutatorId}
    ) => {
      const operationId = dataLoader.share()
      const r = await getRethink()

      // AUTH
      const viewerId = getUserId(authToken)
      if (!isTeamMember(authToken, teamId)) {
        return standardError(new Error('Team not found'), {userId: viewerId})
      }

      // RESOLUTION
      const subOptions = {mutatorId, operationId}
      const users = await r
        .table('User')
        .getAll(r.args(invitees), {index: 'email'})
        .run()

      const uniqueInvitees = Array.from(new Set(invitees as string[]))
      // filter out emails already on team
      const newInvitees = uniqueInvitees.filter((email) => {
        const user = users.find((user) => user.email === email)
        return !(user && user.tms && user.tms.includes(teamId))
      })
      const team = await dataLoader.get('teams').load(teamId)
      const {name: teamName, isOnboardTeam} = team
      const inviter = await dataLoader.get('users').load(viewerId)
      const bufferTokens = await Promise.all<Buffer>(newInvitees.map(() => randomBytes(48)))
      const tokens = bufferTokens.map((buffer: Buffer) => buffer.toString('hex'))
      const expiresAt = new Date(Date.now() + TEAM_INVITATION_LIFESPAN)
      // insert invitation records
      const teamInvitationsToInsert = newInvitees.map((email, idx) => {
        return new TeamInvitation({
          expiresAt,
          email,
          invitedBy: viewerId,
          meetingId,
          teamId,
          token: tokens[idx]
        })
      })
      await r
        .table('TeamInvitation')
        .insert(teamInvitationsToInsert)
        .run()

      // remove suggested action, if any
      let removedSuggestedActionId
      if (isOnboardTeam) {
        removedSuggestedActionId = await removeSuggestedAction(
          viewerId,
          SuggestedActionTypeEnum.inviteYourTeam
        )
      }
      // insert notification records
      const notificationsToInsert = [] as NotificationTeamInvitation[]
      teamInvitationsToInsert.forEach((invitation) => {
        const user = users.find((user) => user.email === invitation.email)
        if (user) {
          notificationsToInsert.push(
            new NotificationTeamInvitation({
              userId: user.id,
              invitationId: invitation.id,
              teamId
            })
          )
        }
      })
      if (notificationsToInsert.length > 0) {
        await r
          .table('Notification')
          .insert(notificationsToInsert)
          .run()
      }

      const bestMeeting = await getBestInvitationMeeting(teamId, meetingId, dataLoader)

      // send emails
      const emailResults = await Promise.all(
        teamInvitationsToInsert.map((invitation) => {
          const user = users.find((user) => user.email === invitation.email)
          return sendEmailPromise(invitation.email, 'teamInvite', {
            inviteLink: makeAppLink(`team-invitation/${invitation.token}`),
            inviteeName: user ? user.preferredName : null,
            inviteeEmail: invitation.email,
            inviterName: inviter.preferredName,
            inviterEmail: inviter.email,
            teamName,
            meeting: bestMeeting
          })
        })
      )

      const successfulInvitees = newInvitees.filter((_email, idx) => emailResults[idx])
      const data = {
        removedSuggestedActionId,
        teamId,
        invitees: successfulInvitees
      }

      // Tell each invitee
      notificationsToInsert.forEach((notification) => {
        const {userId, id: teamInvitationNotificationId} = notification
        const subscriberData = {
          ...data,
          teamInvitationNotificationId
        }
        publish(
          SubscriptionChannel.NOTIFICATION,
          userId,
          'InviteToTeamPayload',
          subscriberData,
          subOptions
        )
      })
      sendSegmentEvent('Invite Email Sent', viewerId, {
        teamId,
        invitees: successfulInvitees
      }).catch()
      return data
    }
  )
}
