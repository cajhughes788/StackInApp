import "express";

declare global {
  namespace Express {
    interface Request {
      /**
       * Firebase Auth verified UID
       */
      uid?: string;

      /**
       * User info decoded from Firebase token
       */
      user?: {
        uid: string;
        email?: string;
        displayName?: string;
        [key: string]: any;
      };
    }
  }
}
