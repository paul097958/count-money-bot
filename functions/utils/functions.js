import { db } from './firebase.js'

export async function getUserData(userId, identity) {
    const doc = await db.collection(identity).doc('config').get()
    if (!doc.exists) return null
    return doc.data().users.find(item => item.uid === userId)
}

export function getFixedOrder(str1, str2) {
    return [str1, str2].sort((a, b) => a.localeCompare(b));
}

export function mergeDebtArrays(oldArray, newArray) {
    const map = new Map();
    oldArray.forEach(item => {
        const key = `${item.first}_${item.second}`;
        map.set(key, { ...item });
    });
    newArray.forEach(newItem => {
        const key = `${newItem.first}_${newItem.second}`;

        if (map.has(key)) {
            const existing = map.get(key);
            existing.debt += newItem.debt;
        } else {
            map.set(key, { ...newItem });
        }
    });
    return Array.from(map.values());
}