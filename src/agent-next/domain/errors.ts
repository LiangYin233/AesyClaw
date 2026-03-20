export class OutboundDispatcherNotConfiguredError extends Error {
  constructor() {
    super('Outbound dispatcher not configured');
    this.name = 'OutboundDispatcherNotConfiguredError';
  }
}
