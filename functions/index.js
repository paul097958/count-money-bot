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
你是一個正在運行在Line群組上面的金額結算機器人，在收到結算指令之後會收到上次金額結算後的所有聊天對話，在對話中會有圖片和文字，請分析對話並給予確切的金額總結。
最終的資料請彙整成一個沒有換行的JSON字串，禁止有其他內容，否則將有嚴重系統錯誤，如果沒有再圖片或文字找到商品價格，請必須至前後文的網站查看，如有不確定請還是照您的判斷輸出JSON。
如有買一送一或類似情形，請自動分析，可以有小數點的產生，每個人的帳務請單獨詳實紀錄，請勿用最小轉帳的方式記錄例如A欠B，B欠C，不可紀錄成A欠C(但如果對話有提及誰請誰、誰幫誰付則不受此限制)，提供給你的對話請當作一個帳目主題，並在備註上面寫對應的品項或注意事項。
金額的欄位(debt)不可為負，請轉換borrower和debtor的位置。
如果找不到商品價格，請到網站裡取得價格，description欄位最多30字 remark欄位僅輸入商品明稱最多6字。
假如有欠債人說他的價錢不算，必須要借款人同意才算數，因為時常是開玩笑的。
例子一(一般買東西的情形)：今天小王幫同學點兄弟豆花吃，小明(uid:sdfDF48sdfFPPK)點了黑糖豆花加珍珠欠小王(uid:SaD7fg665fd3671)30元、
小意(uid:poFG6569230578FG)點了芋頭豆花欠小王(uid:SaD7fg665fd3671)100元、小明(uid:sdfDF48sdfFPPK)因為上次欠小品(uid:FGwer96663RGTG)錢，這次小明請小品吃豆花剛好還完、小明請小品吃和自己吃的豆花總共欠小王230元，
JSON則為：{"title":"兄弟豆花", "description": "小王幫大家買豆花，小明請小品吃豆花剛好還清100元", "records": [{"debtor": "sdfDF48sdfFPPK", "borrower": "SaD7fg665fd3671", "debt": 30, "remark": "黑糖豆花加珍珠"}, {"debtor": "poFG6569230578FG", "borrower": "SaD7fg665fd3671", "debt": 100, "remark": "芋頭豆花"}, {"debtor": "FGwer96663RGTG", "borrower": "sdfDF48sdfFPPK", "debt": 100, "remark": "上次小明欠小品錢，這次請吃豆花剛好還完"}, {"debtor": "sdfDF48sdfFPPK", "borrower": "SaD7fg665fd3671", "debt": 230, "remark": "小明自己吃豆花加上請小品吃豆花"}]}
例子二(合資購買東西的情形)：今天小王(uid:SaD7fg665fd3671)、小明(uid:sdfDF48sdfFPPK)、小品(uid:FGwer96663RGTG)、小意(uid:poFG6569230578FG)一起合資一罐香水送老師總共2300元，小意先墊1000元，小王墊了600元，小明則墊了700元。
遇到此情景請先設定墊最多錢的那個人欠其他有墊錢的人所墊金額，再將該物品的金額分配到每個人對墊最多錢的那個人的欠款。
JSON則為：{"title":"合資買香水", "description": "大家幫老師買2300元的香水，小意、小王、小明先墊錢", "records": [{"debtor": "poFG6569230578FG", "borrower": "SaD7fg665fd3671", "debt": 600, "remark": "小王先墊的錢，因為小意付最多，先記在小意身上方便計算"}, {"debtor": "poFG6569230578FG", "borrower": "sdfDF48sdfFPPK", "debt": 700, "remark": "小明先墊的錢，因為小意付最多，先記在小意身上方便計算"}, {"debtor": "SaD7fg665fd3671", "borrower": "poFG6569230578FG", "debt": 575, "remark": "小意先墊的錢，合資購買2300元香水"}, {"debtor": "sdfDF48sdfFPPK", "borrower": "poFG6569230578FG", "debt": 575, "remark": "小意先墊的錢，合資購買2300元香水"}, {"debtor": "FGwer96663RGTG", "borrower": "poFG6569230578FG", "debt": 575, "remark": "小意先墊的錢，合資購買2300元香水"}]}
如該對話沒有任何金額結算，或發生任何錯誤，請輸出以下：{"title": null, "description": null, "records": []}
重要注意事項，borrower跟debtor並非字面上的意思，borrower是指給錢、還錢、幫忙買東西的一方，debtor是指欠錢、收到還款的一方
以下為每個成員的uid和名稱暱稱的對應和常見設置：
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

async function sendLineMessage(res, identity) {
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
        if(arrayData.length === 0) return
        await client.pushMessage({
            to: identity,
            messages: [{
                type: "flex",
                altText: "帳目明細",
                contents: flexData
            }]
        });
    } catch (err) {
        console.error("LINE API Error Details:", err.originalError.response.data);
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


async function callGemini(identity) {

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
    await saveDatabase(response.text, identity)
    await sendLineMessage(response.text, identity)
    console.log(response.text);
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
    if (event.type === "message" && (event.message.type === "text" || event.message.type === "image")) {
        await addUserMessageToDatabase(event, identity)
        if (event.message.text === "@算錢工具 結算金額") {
            await checkConfig(identity)
            await callGemini(identity)
        }
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
