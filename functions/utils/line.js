import * as line from "@line/bot-sdk";
import dotenv from "dotenv";
dotenv.config();
export const config = {
    channelSecret: process.env.CHANNEL_SECRET,
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
export const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken,
});
