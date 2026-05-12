import mongoose from 'mongoose';
import { connectDB } from './mongodb';
import Interview from '@/models/Interview';

export async function saveInterviewToDB(data: any) {
  await connectDB();
  console.log('Saving interview data:', JSON.stringify(data, null, 2)); // 👈 ADD

  console.log('Saving interview...', data);
  const interview = await Interview.create(data);
  console.log('Saved interview:', interview._id);

  return interview;
}


export async function getInterviewById(id: string) {
  await connectDB();

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null; // prevents CastError
  }

  return Interview.findById(id).lean();
}

export async function getInterviewsFromDB(studyId?: string) {
  await connectDB();

  if (studyId) {
    return Interview.find({ studyId }).sort({ createdAt: -1 }).lean();
  }

  return Interview.find().sort({ createdAt: -1 }).lean();
}