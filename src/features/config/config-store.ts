import type { FullConfig } from '@/features/config/schema.js';
import { logger } from '@/platform/observability/logger.js';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function makeReadOnlyProxy<T extends object>(target: T, seen = new WeakMap<object, object>()): T {
    if (seen.has(target)) {
        return seen.get(target) as T;
    }

    const proxy = new Proxy(target, {
        get(obj, prop, receiver) {
            const value = Reflect.get(obj, prop, receiver);
            if (isObject(value) || Array.isArray(value)) {
                if (isObject(value) && seen.has(value)) {
                    return seen.get(value);
                }
                const wrapped = makeReadOnlyProxy(value as object, seen);
                seen.set(value, wrapped as object);
                return wrapped;
            }
            return value;
        },
        set() {
            return false;
        },
        deleteProperty() {
            return false;
        },
        defineProperty() {
            return false;
        },
        preventExtensions() {
            return true;
        },
        isExtensible() {
            return false;
        },
        getOwnPropertyDescriptor(_obj, prop) {
            const desc = Reflect.getOwnPropertyDescriptor(target, prop);
            if (desc) {
                Object.defineProperty(desc, 'writable', { value: false });
            }
            return desc;
        },
    });

    return proxy as T;
}

export class ConfigStore {
    private _snapshot: FullConfig;
    private _readonlyView: FullConfig;

    constructor(initialSnapshot: FullConfig) {
        this._snapshot = initialSnapshot;
        this._readonlyView = makeReadOnlyProxy(initialSnapshot);
    }

    get snapshot(): FullConfig {
        return this._snapshot;
    }

    get readonlyView(): FullConfig {
        return this._readonlyView;
    }

    replace(newSnapshot: FullConfig): void {
        this._snapshot = newSnapshot;
        this._readonlyView = makeReadOnlyProxy(newSnapshot);
        logger.debug({}, 'ConfigStore snapshot replaced');
    }
}
