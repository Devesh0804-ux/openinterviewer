import { Schema, model, models } from 'mongoose';

const StudySchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    config: { type: Object, required: true },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
    interviewCount: { type: Number, default: 0 },
    isLocked: { type: Boolean, default: false }
  },
  {
    collection: 'studies',
    strict: false
  }
);

export default models.Study || model('Study', StudySchema);
