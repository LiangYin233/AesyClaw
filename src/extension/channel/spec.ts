import { getBusinessDefaults } from '@aesyclaw/extension/config';
import type { ExtensionRuntimeSpec } from '@aesyclaw/extension/spec';
import type { Message, SenderInfo, SessionKey } from '@aesyclaw/core/types';
import { createContext } from './context';
import * as router from './router';
import { discoverChannelDefinition } from './types';
import type { ChannelContext, ChannelManagerDependencies, ChannelPlugin } from './types';

export function createChannelSpec(
  deps: ChannelManagerDependencies,
  chunkBuffers: Map<string, string>,
  receive: (
    channelName: string,
    inbound: Message,
    sessionKey: SessionKey,
    sender?: SenderInfo,
  ) => Promise<void>,
): ExtensionRuntimeSpec<ChannelPlugin, ChannelContext> {
  return {
    kind: 'channel',
    configKey: 'channels',
    dirPrefix: 'channel_',
    extensionsDir: deps.paths.extensionsDir,
    discoverDefinition: discoverChannelDefinition,
    createContext: ({ definition, ref, state }) =>
      createContext(
        deps,
        deps.paths,
        definition.name,
        ref,
        async (msg, sk, sender) => {
          await receive(definition.name, msg, sk, sender);
        },
        state,
      ),
    getManagedDefaults: (definition) => {
      const { enabled: _enabled, ...defaults } = getBusinessDefaults(definition);
      return { enabled: false, ...defaults };
    },
    onBeforeUnload: (definition) => {
      router.cleanupChunkBuffers(chunkBuffers, definition.name);
    },
  };
}
