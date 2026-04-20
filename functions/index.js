import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { join } from 'node:path';
import express from 'express';
import https from 'node:https';
import dotenv from "dotenv";
import axios from "axios";
import { Ollama } from 'ollama'
import * as line from "@line/bot-sdk";
import sendLineMessage from './utils/send_message.js'
import { getFixedOrder, mergeDebtArrays, getUserData } from './utils/functions.js'
import admin from './utils/firebase.js';
import { db, storage, bucket } from './utils/firebase.js'
import { config, client } from './utils/line.js';
dotenv.config();
const app = express();
const grayIcon = 'https://firebasestorage.googleapis.com/v0/b/count-money-579c7.firebasestorage.app/o/line-images%2Fgray-icon.png?alt=media&token=3f7d7e68-3e7e-478c-b785-f758789d8411'

async function readTxtFile() {
    try {
        const filePath = join(process.cwd(), 'resources', 'prompt.txt');
        const data = await readFile(filePath, 'utf8');
        return data;
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('錯誤：找不到檔案，請檢查 ./resource 目錄下是否有 data.txt');
        } else {
            console.error('讀取時發生錯誤：', err);
        }
    }
}

const instruction = await readTxtFile();

async function getGCSImageBase64(gsPath) {
    try {
        if (!gsPath.startsWith("gs://")) {
            throw new Error("路徑格式錯誤，必須以 gs:// 開頭");
        }
        const fullPath = gsPath.replace("gs://", "");
        const slashIndex = fullPath.indexOf("/");
        const bucketName = fullPath.substring(0, slashIndex);
        const fileName = fullPath.substring(slashIndex + 1);
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(fileName);
        const [buffer] = await file.download();
        return buffer.toString('base64');
    } catch (error) {
        console.error(`轉換 ${gsPath} 失敗:`, error.message);
        throw error;
    }
}

async function getMessagesUntilCount(identity) {
    const snapshot = await db.collection(identity).orderBy("timestamp", "desc").get();
    const messages = [];
    let first = true;
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.content === "@算錢工具 結算金額") {
            if (first) {
                first = false;
            } else {
                break;
            }
        }
        if (data.content === "@算錢工具 結算節點") {
            break;
        }
        if (data.type === "text") {
            messages.push({
                role: 'user',
                content: `(message id: ${doc.id}) ${data.sender}: ${data.content}`
            });
        } else if (data.type === "image") {
            messages.push({
                role: 'user',
                content: `(message id: ${doc.id}) ${data.sender}傳了一張圖片：`,
                images: [await getGCSImageBase64(data.content)]
            });
        }
    }
    return messages.reverse();
}

async function storeImage(event, identity) {
    const messageId = event.message.id;
    console.log(messageId);
    const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`,
        }, responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data);
    const file = bucket.file(`line-images/${messageId}.jpg`);
    await file.save(buffer, { metadata: { contentType: "image/jpeg" }, });
    const gsUri = `gs://${bucket.name}/${file.name}`;
    await db.collection(identity).doc(event.message.id).set({ sender: event.source.userId, type: "image", content: gsUri, timestamp: event.timestamp });
}




async function saveDatabase(res, identity) {
    const obj = JSON.parse(res);
    const recordsData = obj.records
    const newRecords = recordsData.map(item => {
        let userOrder = getFixedOrder(item.borrower, item.debtor)
        if (item.borrower === userOrder[0]) {
            // debt shows as first presents
            // debt shows as borrower presents
            // tip: positive is positive
            return {
                first: userOrder[0],
                second: userOrder[1],
                debt: item.debt
            }
        } else {
            return {
                first: userOrder[0],
                second: userOrder[1],
                debt: -item.debt
            }
        }
    })
    const uniqueUids = [...new Set(newRecords.flatMap(item => [item.first, item.second]))];
    const docRef = db.collection(identity).doc('config');
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (!doc.exists) {
                throw '文件不存在！';
            }
            const oldRecords = doc.data().records;
            const resultRecords = mergeDebtArrays(oldRecords, newRecords)
            t.update(docRef, { records: resultRecords });
        });
        const recordDocRef = await db.collection(identity).add({
            ...obj,
            users: uniqueUids,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("新文件已建立，ID 為:", recordDocRef.id, '\n');
    } catch (e) {
        console.log('交易失敗:', e);
    }

}


async function callGemini(identity, event) {
    const docRef = db.collection(identity).doc("config");
    const doc = await docRef.get();
    if (!doc.exists) {
        console.log('找不到該config');
        return null;
    }
    const idnetityData = doc.data();
    const chatHistory = await getMessagesUntilCount(identity);
    if (chatHistory.length === 0) return
    console.log(`總共${chatHistory.length}條消息，準備call AI`);
    const ollama = new Ollama({ host: process.env.API_URL })
    const response = await ollama.chat({
        model: 'gemma4:latest',
        messages: [{ role: 'system', content: instruction + idnetityData.prompt }, ...chatHistory],
        format: 'json',
        stream: false,
        options: {
            temperature: 0
        }
    });
    console.log('AI的回覆：', response.message.content);
    return response.message.content
}

async function addUserMessageToDatabase(event, identity) {
    if (event.message.type === "image") {
        await storeImage(event, identity)
    } else {
        if (event.message.quotedMessageId) {
            await db.collection(identity).doc(event.message.id).set({
                sender: event.source.userId,
                type: "text",
                content: `我正在回覆message id為${event.message.quotedMessageId}的訊息：${event.message.text}`,
                timestamp: event.timestamp
            });
        } else {
            await db.collection(identity).doc(event.message.id).set({
                sender: event.source.userId,
                type: "text",
                content: event.message.text,
                timestamp: event.timestamp
            });
        }
    }
}

function updateOrAddUser(array, updateData) {
    const { uid } = updateData;
    const newArray = [...array];
    const index = newArray.findIndex(item => item.uid === uid);
    if (index !== -1) {
        newArray[index] = { ...newArray[index], ...updateData };
    } else {
        newArray.push({
            name: '',
            photo: '',
            ...updateData
        });
    }
    return newArray;
}

async function updateUsers(identity, userData) {
    const docRef = db.collection(identity).doc('config');
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (!doc.exists) {
                throw '文件不存在！';
            }
            const oldUsers = doc.data().users || [];
            const newUsers = updateOrAddUser(oldUsers, userData)
            t.update(docRef, { users: newUsers });
        });
    } catch (e) {
        console.log('交易失敗:', e);
    }
}

async function checkConfig(identity) {
    const docRef = db.collection(identity).doc("config");
    const doc = await docRef.get();
    if (!doc.exists) {
        await db.collection(identity).doc('config').set({
            prompt: '',
            users: [],
            records: []
        });
    }
}

async function getUserProfile(event) {
    try {
        let profile;
        if (event.source.type === 'group') {
            profile = await client.getGroupMemberProfile(event.source.groupId, event.source.userId)
        } else if (event.source.type === 'room') {
            profile = await client.getRoomMemberProfile(event.source.roomId, event.source.userId)
        }
        return profile;
    } catch (error) {
        console.error("Error fetching profile:", error.message);
        return false
    }
}

async function checkJSONValid(res, identity) {
    const obj = JSON.parse(res);
    if (!obj?.title && typeof obj?.title !== 'string') return { status: false, message: '缺少title' }
    if (!obj?.description && typeof obj?.description !== 'string') return { status: false, message: '缺少description' }
    if (obj?.records?.length === 0) return { status: false, message: 'records長度為零' }
    for (const item of obj.records) {
        if (!item?.borrower && typeof item?.borrower !== 'string') return { status: false, message: 'records中缺少borrower或borrower不是string' }
        if (!item?.debtor && typeof item?.debtor !== 'string') return { status: false, message: 'records中缺少debtor或debtor不是string' }
        if (typeof item?.debt !== 'number') return { status: false, message: 'records中缺少debt或debt不是number' }
        if (!item?.remark && typeof item?.remark !== 'string') return { status: false, message: 'records中缺少remark或remark不是string' }
        const borrowerUserData = await getUserData(item.borrower, identity);
        const debtorUserData = await getUserData(item.debtor, identity);
        if (!borrowerUserData) return { status: false, message: `找不到borrower ${item.borrower}的用戶資料` }
        if (!debtorUserData) return { status: false, message: `找不到debtor ${item.debtor}的用戶資料` }
    }
    return { status: true }
}

async function handleEvent(event) {
    if (event.source.type === 'user') return
    let identity;
    if (event.source.type === 'room') {
        identity = event.source.roomId;
    } else if (event.source.type === 'group') {
        identity = event.source.groupId;
    }
    const userProfile = await getUserProfile(event)
    console.log(`${userProfile.displayName}傳送了：${event.message.text} 在 ${identity}`);
    await updateUsers(identity, { uid: event.source.userId, name: userProfile.displayName, photo: userProfile.pictureUrl || grayIcon })
    await checkConfig(identity)
    if (event.type === "message" && (event.message.type === "text" || event.message.type === "image")) {
        await handleUnsend(identity, event)
        await addUserMessageToDatabase(event, identity)
        if (event.message.text === "@算錢工具 結算金額") {
            const res = await callGemini(identity, event)
            const resStatus = await checkJSONValid(res, identity)
            if (resStatus.status) {
                await saveDatabase(res, identity)
                await sendLineMessage(res, identity, event);
            } else {
                console.log('格式錯誤：', resStatus.status)
            }

        }
    }

}

async function handleUnsend(identity, event) {
    if (event.type === 'unsend') {
        const unsendMessageId = event.unsend.messageId
        const userId = event.source.userId;
        console.log(`使用者 ${userId} 收回了訊息，ID 為: ${unsendMessageId}`);
        try {
            await db.collection(identity).doc(unsendMessageId).delete();
            console.log(`成功刪除文件: ${unsendMessageId}`);
        } catch (error) {
            console.error('刪除文件時出錯:', error);
        }
        return;
    }
}


app.get('/test', async (req, res) => {
    res.send("Hello World!");
})

app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        const events = req.body.events;

        // 併發處理所有 event
        await Promise.all(events.map(event => handleEvent(event)));

        res.status(200).send("OK");
    } catch (error) {
        console.error("Error handling event:", error);
        res.status(500).send("Internal Server Error");
    }
});

const sslOptions = {
    cert: fs.readFileSync(path.join(process.cwd(), '../ssl/fullchain.pem')),
    key: fs.readFileSync(path.join(process.cwd(), '../ssl/privkey.pem'))
};

const PORT = 9000;
const HOST = '0.0.0.0';

https.createServer(sslOptions, app).listen(PORT, HOST, () => {
    console.log(`🚀 LINE Bot HTTPS Server 啟動成功！`);
    console.log(`🔗 監聽網址: https://${HOST}:${PORT}/webhook`);
    console.log(`⚠️ 請確保你的防火牆已開啟 9000 埠`);
});