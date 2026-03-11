import * as functions from "firebase-functions";
import * as line from "@line/bot-sdk";
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
dotenv.config();
admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();
const bucket = admin.storage().bucket();
const ai = new GoogleGenAI({ apiKey: process.env.AI_KEY });
const config = {
    channelSecret: process.env.CHANNEL_SECRET,
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken,
});
const grayIcon = 'https://firebasestorage.googleapis.com/v0/b/count-money-579c7.firebasestorage.app/o/line-images%2Fgray-icon.png?alt=media&token=3f7d7e68-3e7e-478c-b785-f758789d8411'
const arrowIcon = 'https://firebasestorage.googleapis.com/v0/b/count-money-579c7.firebasestorage.app/o/line-images%2F%E2%80%94Pngtree%E2%80%94right%20arrow%20glyph%20black%20icon_3755432.png?alt=media&token=114b5130-0519-4982-bda7-60a9dd9d64d1'
const instruction = `
Role:
你是一個運行於 Line 群組的金額結算機器人。你的任務是分析自上次結算後的所有聊天對話（包含圖片與文字），精確總結各成員間的帳務往來。
Output Format:
必須輸出為一個沒有換行的 JSON 字串。
禁止包含任何非 JSON 的解釋文字或前導字，否則將會遇到嚴重錯誤。
若無金額結算或發生錯誤，輸出：{"title": null, "description": null, "records": []}
Calculation Rules:
資料獲取： 若對話/圖片中未提及商品價格，必須造訪對話中提供的網址查詢。若判斷困難，請依據上下文自行判斷並輸出結果。
優惠分析： 自動處理「買一送一」或類似折扣，金額可保留小數點。
紀錄原則： * 詳實紀錄每個人的獨立帳務，禁止進行最小轉帳化簡（例如：不可將 A 欠 B、B 欠 C 直接合併為 A 欠 C），除非對話明確提及「誰幫誰付」或「抵銷」，borrower跟debtor不可為同一人。
每個帳單主題中，每個人只能有一個 record。 若一人點了多項商品，請合併計費。
金額欄位 (debt) 不可為負數。若為負值，請調換 borrower 與 debtor 的位置。
特殊身分定義（重要）：*借錢給別人的人不一定是「借款人」，欠錢的人也不一定是「欠債者」。請根據對話內容判斷雙方的角色。例如，A還B錢，A就是borrower
borrower: 出錢、代墊、還錢、幫忙買東西的一方。
debtor: 欠錢、收到還款、被請客的一方。
合資邏輯： 若多人合資，請設定「墊最多錢的人」為核心，先記錄該核心成員欠其他墊錢者的金額，再將總金額按比例分配為其他成員對該核心成員的欠款。
有效性判斷： 若欠債者表示「價格不算數」，必須經過借款人同意才可採計（排除開玩笑的情況）。
Field Constraints:
title: 該帳目主題。
description: 帳務摘要，限 30 字內。
remark: 商品名稱或注意事項，限 10 字內。
Example 1 (一般購買):
對話：小王幫點豆花。小明(sdfDF48sdfFPPK)點黑糖豆花加珍珠欠小王(SaD7fg665fd3671) 30元；小意(poFG6569230578FG)點芋頭豆花欠小王 100元；小明請小品(FGwer96663RGTG)吃豆花抵銷舊欠，小明總共欠小王 230元。
JSON：{"title":"兄弟豆花", "description": "小王幫大家買豆花，小明請小品吃豆花剛好還清100元", "records": [{"debtor": "sdfDF48sdfFPPK", "borrower": "SaD7fg665fd3671", "debt": 30, "remark": "黑糖豆花"}, {"debtor": "poFG6569230578FG", "borrower": "SaD7fg665fd3671", "debt": 100, "remark": "芋頭豆花"}, {"debtor": "FGwer96663RGTG", "borrower": "sdfDF48sdfFPPK", "debt": 100, "remark": "還清舊帳"}, {"debtor": "sdfDF48sdfFPPK", "borrower": "SaD7fg665fd3671", "debt": 230, "remark": "自吃加請客"}]}
Example 2 (合資購買):
對話：小王(SaD7fg665fd3671)、小明(sdfDF48sdfFPPK)、小品(FGwer96663RGTG)、小意(poFG6569230578FG)合資 2300元香水。小意墊 1000, 小王墊 600, 小明墊 700。
JSON：{"title":"合資買香水", "description": "大家幫老師買2300元的香水，小意、小王、小明先墊錢", "records": [{"debtor": "poFG6569230578FG", "borrower": "SaD7fg665fd3671", "debt": 600, "remark": "墊款轉移"}, {"debtor": "poFG6569230578FG", "borrower": "sdfDF48sdfFPPK", "debt": 700, "remark": "墊款轉移"}, {"debtor": "SaD7fg665fd3671", "borrower": "poFG6569230578FG", "debt": 575, "remark": "香水分擔"}, {"debtor": "sdfDF48sdfFPPK", "borrower": "poFG6569230578FG", "debt": 575, "remark": "香水分擔"}, {"debtor": "FGwer96663RGTG", "borrower": "poFG6569230578FG", "debt": 575, "remark": "香水分擔"}]}
注意事項：debtor和borrower不可為同一人，請仔細看清楚誰點了什麼，照片的內容請看清楚，否則將有嚴重損失。
以下是人員清單：
`

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
                text: `(message id: ${doc.id}) ${data.sender}: ${data.content}`
            });
        } else if (data.type === "image") {
            messages.push({
                text: `(message id: ${doc.id}) ${data.sender}: 我傳了一張圖片。`
            });
            messages.push({
                inlineData: { mimeType: "image/jpeg", data: await getGCSImageBase64(data.content) }
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

async function getUserData(userId, identity) {
    const doc = await db.collection(identity).doc('config').get()
    if (!doc.exists) return null
    return doc.data().users.find(item => item.uid === userId)
}

async function sendLineMessage(res, identity, event) {
    const obj = JSON.parse(res);
    const arrayData = await Promise.all(obj.records.map(async item => {
        const borrowerData = await getUserData(item.borrower, identity);
        const debtorData = await getUserData(item.debtor, identity);
        return {
            type: "box",
            layout: "horizontal",
            contents: [
                {
                    type: "box",
                    layout: "vertical",
                    contents: [
                        {
                            type: "text",
                            text: '$' + item.debt.toLocaleString(),
                            weight: "bold",
                            size: "xl"
                        },
                        {
                            type: "text",
                            text: item.remark || " ",
                            size: "xs",
                            color: "#9D9D9D",
                            gravity: "center",
                            wrap: true
                        }
                    ],
                    margin: "xs",
                    spacing: "sm",
                    justifyContent: "center",
                    alignItems: "center",
                    flex: 2
                },
                {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                        {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "image",
                                    url: borrowerData.photo || grayIcon,
                                    size: "40px",
                                    aspectMode: "fit"
                                },
                                {
                                    type: "text",
                                    text: borrowerData.name,
                                    align: "center",
                                    size: "xxs",
                                    wrap: false
                                }
                            ]
                        },
                        {
                            type: "image",
                            url: arrowIcon,
                            size: "35px",
                            aspectMode: "fit"
                        },
                        {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "image",
                                    url: debtorData.photo || grayIcon,
                                    size: "40px",
                                    aspectMode: "fit"
                                },
                                {
                                    type: "text",
                                    text: debtorData.name,
                                    align: "center",
                                    size: "xxs",
                                    wrap: false
                                }
                            ]
                        }
                    ],
                    alignItems: "center",
                    flex: 3,
                    paddingAll: "md"
                }
            ],
            margin: "lg"
        };
    }));

    const flexData = {
        type: "bubble",
        header: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "帳單明細",
                    color: "#E0E0E0",
                    size: "md"
                }
            ]
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: obj.title || "未命名帳目",
                    weight: "bold",
                    wrap: true,
                    size: "xl"
                },
                {
                    type: "text",
                    text: obj.description || " ",
                    color: "#9D9D9D",
                    wrap: true,
                    size: "16px"
                },
                ...arrayData,
                {
                    type: "text",
                    text: "此帳目為AI生成如有錯誤，請按下方更改按鈕",
                    margin: "lg",
                    size: "xxs",
                    color: "#BEBEBE"
                }
            ]
        },
        footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
                {
                    type: "button",
                    style: "link",
                    height: "sm",
                    action: {
                        type: "uri",
                        label: "更改",
                        uri: "https://line.me/"
                    }
                }
            ]
        },
        styles: {
            header: {
                backgroundColor: "#004B97"
            }
        }
    };

    try {
        if (arrayData.length === 0) return
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: "flex",
                altText: "帳目明細",
                contents: flexData
            }]
        });
    } catch (err) {
        const errorDetail = err.originalError?.response?.data || err.message || err;
        console.error("LINE API Error Details:", errorDetail);
    }
}

function getFixedOrder(str1, str2) {
    return [str1, str2].sort((a, b) => a.localeCompare(b));
}

function mergeDebtArrays(oldArray, newArray) {
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
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("新文件已建立，ID 為:", recordDocRef.id);
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
    console.log(chatHistory);
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        config: {
            systemInstruction: instruction + idnetityData.prompt,
            tools: [{ urlContext: {} }],
        },
        generationConfig: {
            temperature: 0
        },
        contents: [{
            role: 'user',
            parts: chatHistory
        }]
    });
    console.log(response.text);
    if (response.usageMetadata) {
        console.log("--- Token 統計 ---");
        console.log("輸入 (Prompt) Token:", response.usageMetadata.promptTokenCount);
        console.log("輸出 (Candidates) Token:", response.usageMetadata.candidatesTokenCount);
        console.log("總計 (Total) Token:", response.usageMetadata.totalTokenCount);
    } else {
        console.log("無法獲取 Token 資訊");
    }
    await saveDatabase(response.text, identity)
    await sendLineMessage(response.text, identity, event);
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
    }
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
    console.log(userProfile, event.source.userId);
    await updateUsers(identity, { uid: event.source.userId, name: userProfile.displayName, photo: userProfile.pictureUrl || grayIcon })
    await handleUnsend(identity, event)
    if (event.type === "message" && (event.message.type === "text" || event.message.type === "image")) {
        await addUserMessageToDatabase(event, identity)
        if (event.message.text === "@算錢工具 結算金額") {
            await checkConfig(identity)
            await callGemini(identity, event)
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


export const webhook = functions.https.onRequest({
    region: 'asia-east1',
    memory: '512MiB',
    timeoutSeconds: 120
}, (req, res) => {
    line.middleware(config)(req, res, async (err) => {
        if (err) {
            console.error("Signature validation failed:", err);
            return res.status(400).send("Bad Request");
        }
        try {
            const events = req.body.events;
            for (const event of events) {
                await handleEvent(event);
            }
            res.status(200).send("OK");
        } catch (error) {
            console.error("Error handling event:", error);
            res.status(500).send("Internal Server Error");
        }
    });
});
