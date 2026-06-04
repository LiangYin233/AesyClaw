import { Type, type Static } from '@sinclair/typebox';

export const WebuiPluginConfigSchema = Type.Object({
  host: Type.String({ default: '127.0.0.1' }),
  port: Type.Integer({ default: 3000, minimum: 1, maximum: 65535 }),
  authToken: Type.Optional(Type.String()),
});

export type WebuiPluginConfig = Static<typeof WebuiPluginConfigSchema>;
