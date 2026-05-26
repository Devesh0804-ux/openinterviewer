import { Schema, model, models } from 'mongoose';

const InterviewSchema = new Schema(
  {
    id: { type: String, unique: true, sparse: true, index: true },
    studyId: { type: String, index: true },
    studyName: { type: String },
    participantName: { type: String },
    token: { type: String, unique: true, sparse: true },
    participantEmail: { type: String },
    participantProfile: { type: Object, default: {} },
    transcript: { type: Array, default: [] },
    messages: { type: Array, default: [] },
    history: { type: Array, default: [] },
    synthesis: { type: Object, default: null },
    behaviorData: { type: Object, default: null },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'in_progress', 'completed', 'terminated'],
      default: 'pending'
    },
    expiresAt: { type: Date },
    createdAt: { type: Schema.Types.Mixed },
    completedAt: { type: Schema.Types.Mixed },
    updatedAt: { type: Schema.Types.Mixed }
  },
  {
    collection: 'interviews',
    strict: false
  }
);

export default models.Interview || model('Interview', InterviewSchema);
