import type { ChannelMessageApi, ChannelManagerDependencies } from './types';

export function createChannelMessageApi(
  deps: ChannelManagerDependencies,
  receive: ChannelMessageApi['receive'],
): ChannelMessageApi {
  return {
    receive,
    getCommands: () =>
      deps.commandRegistry.getAll().map(({ execute: _execute, ...command }) => command),
  };
}
