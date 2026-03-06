/**
 * Lightweight Dependency Injection Container
 *
 * Provides service registration, resolution, and lifecycle management.
 * Supports both transient and singleton service lifetimes.
 */

import { logger } from '../logger/index.js';

const log = logger.child({ prefix: 'DI' });

export type ServiceFactory<T> = (container: Container) => T | Promise<T>;

export interface ServiceRegistration<T> {
  factory: ServiceFactory<T>;
  singleton: boolean;
  instance?: T;
}

export class Container {
  private services = new Map<symbol, ServiceRegistration<any>>();
  private resolving = new Set<symbol>();

  /**
   * Register a transient service (new instance per resolve)
   */
  register<T>(token: symbol, factory: ServiceFactory<T>): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token.toString()}`);
    }
    this.services.set(token, { factory, singleton: false });
    log.debug(`Registered transient service: ${token.toString()}`);
  }

  /**
   * Register a singleton service (single instance, lazy-initialized)
   */
  registerSingleton<T>(token: symbol, factory: ServiceFactory<T>): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token.toString()}`);
    }
    this.services.set(token, { factory, singleton: true });
    log.debug(`Registered singleton service: ${token.toString()}`);
  }

  /**
   * Register an existing instance as a singleton
   */
  registerInstance<T>(token: symbol, instance: T): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token.toString()}`);
    }
    this.services.set(token, {
      factory: () => instance,
      singleton: true,
      instance
    });
    log.debug(`Registered instance: ${token.toString()}`);
  }

  /**
   * Resolve a service by token
   * Throws if service not registered or circular dependency detected
   */
  async resolve<T>(token: symbol): Promise<T> {
    const registration = this.services.get(token);
    if (!registration) {
      throw new Error(`Service not registered: ${token.toString()}`);
    }

    // Check for circular dependencies
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency detected: ${token.toString()}`);
    }

    // Return cached singleton instance
    if (registration.singleton && registration.instance !== undefined) {
      return registration.instance;
    }

    // Resolve new instance
    this.resolving.add(token);
    try {
      const instance = await registration.factory(this);

      // Cache singleton instance
      if (registration.singleton) {
        registration.instance = instance;
      }

      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Synchronous resolve (throws if factory is async)
   */
  resolveSync<T>(token: symbol): T {
    const registration = this.services.get(token);
    if (!registration) {
      throw new Error(`Service not registered: ${token.toString()}`);
    }

    // Return cached singleton instance
    if (registration.singleton && registration.instance !== undefined) {
      return registration.instance;
    }

    // Check for circular dependencies
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency detected: ${token.toString()}`);
    }

    this.resolving.add(token);
    try {
      const instance = registration.factory(this);

      // Ensure factory is not async
      if (instance instanceof Promise) {
        throw new Error(`Cannot resolve async factory synchronously: ${token.toString()}`);
      }

      // Cache singleton instance
      if (registration.singleton) {
        registration.instance = instance;
      }

      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Check if a service is registered
   */
  has(token: symbol): boolean {
    return this.services.has(token);
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
    log.debug('Container cleared');
  }

  /**
   * Get all registered service tokens
   */
  getRegisteredTokens(): symbol[] {
    return Array.from(this.services.keys());
  }
}
