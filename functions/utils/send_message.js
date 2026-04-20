import { getUserData } from './functions.js';
import { client } from './line.js'
import dotenv from "dotenv";
dotenv.config();
const grayIcon = 'https://firebasestorage.googleapis.com/v0/b/count-money-579c7.firebasestorage.app/o/line-images%2Fgray-icon.png?alt=media&token=3f7d7e68-3e7e-478c-b785-f758789d8411'
const arrowIcon = 'https://firebasestorage.googleapis.com/v0/b/count-money-579c7.firebasestorage.app/o/line-images%2F%E2%80%94Pngtree%E2%80%94right%20arrow%20glyph%20black%20icon_3755432.png?alt=media&token=114b5130-0519-4982-bda7-60a9dd9d64d1'

export default async function sendLineMessage(res, identity, event) {
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
                        uri: `https://liff.line.me/${process.env.LINE_LIFF}/?g=${identity}`
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
