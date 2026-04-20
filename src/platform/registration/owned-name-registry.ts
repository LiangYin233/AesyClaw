import { type RegistrationOwner, getRegistrationOwnerKey } from './types.js';

export class OwnedNameRegistry {
  private readonly ownerNames: Map<string, Set<string>> = new Map();

  list(owner: RegistrationOwner): string[] {
    return Array.from(this.ownerNames.get(getRegistrationOwnerKey(owner)) ?? []);
  }

  add(owner: RegistrationOwner, name: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerNames.get(ownerKey) ?? new Set<string>();
    names.add(name);
    this.ownerNames.set(ownerKey, names);
  }

  remove(owner: RegistrationOwner, name: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerNames.get(ownerKey);
    if (!names) {
      return;
    }

    names.delete(name);
    if (names.size === 0) {
      this.ownerNames.delete(ownerKey);
    }
  }
}
