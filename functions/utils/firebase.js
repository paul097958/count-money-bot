import * as functions from "firebase-functions";
import admin from "firebase-admin";
import serviceAccount from '../../service.json' with { type: 'json' };

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "count-money-579c7.firebasestorage.app"
});

export const db = admin.firestore();
export const storage = admin.storage();
export const bucket = storage.bucket();
export default admin;