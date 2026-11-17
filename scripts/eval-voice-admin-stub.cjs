// Stands in for backend/functions/src/admin.ts when the voice expense eval
// loads the server parser: the eval passes its own learned lookup, so
// Firestore is never touched.
module.exports = { db: null };
