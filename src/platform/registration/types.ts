export type RegistrationOwnerKind = 'system' | 'plugin' | 'mcp';

export interface RegistrationOwner {
  kind: RegistrationOwnerKind;
  id: string;
}

export interface RegistrationHandle {
  readonly name: string;
  readonly owner: RegistrationOwner;
  dispose(): boolean;
}

export function createRegistrationOwner(kind: RegistrationOwnerKind, id: string): RegistrationOwner {
  return { kind, id };
}

export function getRegistrationOwnerKey(owner: RegistrationOwner): string {
  return `${owner.kind}:${owner.id}`;
}
