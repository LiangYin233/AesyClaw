import { Type, type Static } from '@sinclair/typebox';

export const WebuiPluginConfigSchema = Type.Object({
  host: Type.String({ default: '127.0.0.1' }),
  port: Type.Integer({ default: 3000, minimum: 1, maximum: 65535 }),
  authToken: Type.Optional(Type.String()),
  devServerUrl: Type.Optional(Type.String({ default: 'http://127.0.0.1:5173' })),
  enabledServer: Type.Boolean({ default: false }),
});

export type WebuiPluginConfig = Static<typeof WebuiPluginConfigSchema>;
