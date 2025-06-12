import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  ACCESS_TOKEN: z.string(),
  HOMESERVER: z.string().url(),
  API_KEY: z.string(),
  SELF_URL: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),
  SHARED_SECRET: z.string(),
});

export default envSchema.parse(process.env);
