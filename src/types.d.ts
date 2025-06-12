declare type RoomMessageEvent = {
  type: "m.room.message";
  sender: string;
  content: {
    body: string;
    "m.mentions": Array<{ user_id: string }>;
    msgtype: "m.text" | "m.notice" | "m.emote";
  };
  origin_server_ts: number;
  event_id: string;
};

declare type DMs = {
  [userId: string]: string[];
};
