import {
  AutojoinRoomsMixin,
  AutojoinUpgradedRoomsMixin,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import env from "./utils/env.js";
import express from "express";
import type { Request, Response } from "express";
import { LastFMAuth, LastFMUser } from "lastfm-ts-api";
import { PrismaClient } from "../src/generated/prisma/client.js";

const storage = new SimpleFsStorageProvider("store.json");
const crypto = new RustSdkCryptoStorageProvider("crypto-store");

const client = new MatrixClient(
  env.HOMESERVER,
  env.ACCESS_TOKEN,
  storage,
  crypto
);
AutojoinRoomsMixin.setupOnClient(client);
AutojoinUpgradedRoomsMixin.setupOnClient(client);

const api = express();
api.use(express.json());
api.listen(env.PORT, () => {
  console.log(`API server started on port ${env.PORT}`);
});

const authAPI = new LastFMAuth(env.API_KEY, env.SHARED_SECRET);

client.on("room.message", handleCommand);
client.start().then(() => console.log("Bot started!"));

const prisma = new PrismaClient();

api.get("/connect", (req: Request, res: Response) => {
  res.redirect(
    `https://www.last.fm/api/auth/?api_key=${env.API_KEY}&cb=${env.SELF_URL}/connect/callback`
  );
});
api.get("/connect/callback", async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (typeof token !== "string") {
      res.status(400).send("Invalid token");
      return;
    }
    const session = await authAPI.getSession({ token: token });
    const linkingCode = Math.floor(Math.random() * 1000000000)
      .toString()
      .padStart(9, "0");
    await prisma.pendingTokenConnection.create({
      data: {
        code: linkingCode,
        sessionKey: session.session.key,
        linkExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      },
    });
    res.send(
      `Got your token! at some point in the next 5 minutes, send this message in any channel with the bot: \`my last.fm bot linking code is ${linkingCode}\``
    );
  } catch (error) {
    console.error("Error during Last.fm authentication:", error);
    res.status(500).send("Authentication failed");
    return;
  }
});

async function handleCommand(roomId: string, e: any) {
  const event = e as RoomMessageEvent;
  if (event.content.msgtype !== "m.text") return;
  if (event.sender === (await client.getUserId())) return;

  const body = event.content.body.toLowerCase();

  if (body == "is fm bot online?") {
    client.replyNotice(
      roomId,
      event,
      `yeah! ${process.uptime()} seconds and counting!`
    );
  }
  if (body == "i want to connect my last.fm account to the bot") {
    client.replyNotice(
      roomId,
      event,
      `rad, go to ${env.SELF_URL}/connect to do that`
    );
  }
  if (body.startsWith("my last.fm bot linking code is")) {
    try {
      const code = body.split(" ").slice(-1)[0];
      const pendingConnection = await prisma.pendingTokenConnection.findFirst({
        where: {
          code: code,
          linkExpiresAt: {
            gt: new Date(),
          },
        },
      });
      if (!pendingConnection) {
        client.replyNotice(
          roomId,
          event,
          "no its not you lier (maybe it expired?)"
        );
        return;
      }
      await prisma.matrixUser.upsert({
        where: { userId: event.sender },
        update: {
          sessionKey: pendingConnection.sessionKey,
        },
        create: {
          userId: event.sender,
          sessionKey: pendingConnection.sessionKey,
        },
      });
      await prisma.pendingTokenConnection.delete({
        where: { code: pendingConnection.code },
      });
      const user = await new LastFMUser(
        env.API_KEY,
        env.SHARED_SECRET,
        pendingConnection.sessionKey
      ).getInfo({});
      client.replyNotice(
        roomId,
        event,
        `you're all linked up, ${user.user.realname}!`
      );
    } catch (error) {
      console.error("Error handling command:", error);
      client.replyNotice(roomId, event, "whoops an error :(");
    }
  }
  if (body == "what is my last.fm username?") {
    try {
      const user = await prisma.matrixUser.findUnique({
        where: { userId: event.sender },
      });
      if (!user) {
        client.replyNotice(
          roomId,
          event,
          "i have no idea! you need to link your account first, please declare `i want to connect my last.fm account to the bot`"
        );
        return;
      }
      const lastfmUser = await new LastFMUser(
        env.API_KEY,
        env.SHARED_SECRET,
        user.sessionKey
      ).getInfo({});
      client.replyNotice(
        roomId,
        event,
        `your username is ${lastfmUser.user.name}`
      );
    } catch (error) {
      console.error("Error handling command:", error);
      client.replyNotice(roomId, event, "whoops an error :(");
    }
  }
  if (event.content.body == "SONG") {
    try {
      const userRecord = await prisma.matrixUser.findUnique({
        where: { userId: event.sender },
      });
      if (!userRecord) {
        client.replyNotice(
          roomId,
          event,
          "who even are you?? you need to link your account first, please declare `i want to connect my last.fm account to the bot`"
        );
        return;
      }
      const userapi = new LastFMUser(
        env.API_KEY,
        env.SHARED_SECRET,
        userRecord.sessionKey
      );
      const user = await userapi.getInfo({});
      const song = await userapi.getRecentTracks({
        limit: 1,
        user: user.user.name,
      });
      if (song.recenttracks.track.length === 0) {
        client.replyNotice(
          roomId,
          event,
          "you haven't scrobbled anything yet!"
        );
        return;
      }
      const currentTrack = song.recenttracks.track[0];
      client.replyHtmlText(
        roomId,
        event,
        `${currentTrack.artist["#text"]} - <a href="${currentTrack.url}">${currentTrack.name}</a>`
      );
    } catch (error) {
      console.error("Error handling command:", error);
      client.replyNotice(roomId, event, "whoops an error :(");
    }
  }
}
