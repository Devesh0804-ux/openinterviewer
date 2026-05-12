import mongoose from 'mongoose';

const RAW_MONGODB_URI = process.env.MONGODB_URI?.trim().replace(/^['"]|['"]$/g, '');

function ensureDatabaseInUri(uri?: string) {
  if (!uri) return uri;

  const queryIndex = uri.indexOf('?');
  const beforeQuery = queryIndex === -1 ? uri : uri.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : uri.slice(queryIndex);
  const authIndex = beforeQuery.lastIndexOf('@');
  const hostStart = authIndex === -1
    ? beforeQuery.indexOf('://') + 3
    : authIndex + 1;
  const hostAndPath = beforeQuery.slice(hostStart);

  if (hostAndPath.includes('/')) return uri;

  return `${beforeQuery}/test${query}`;
}

const MONGODB_URI = ensureDatabaseInUri(RAW_MONGODB_URI);

let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

export function isMongoConfigured() {
  return Boolean(MONGODB_URI);
}

export async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000
      })
      .then((mongoose) => mongoose)
      .catch((error) => {
        cached.promise = null;
        throw error;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
