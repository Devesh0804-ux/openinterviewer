import { Schema, model, models } from 'mongoose';

const ParticipantTokenSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    studyId: { type: String, required: true, index: true },
    studyConfig: { type: Object, required: true },
    expiresAt: { type: Date, required: true, expires: 0 }
  },
  {
    collection: 'participant_tokens'
  }
);

export default models.ParticipantToken || model('ParticipantToken', ParticipantTokenSchema);
