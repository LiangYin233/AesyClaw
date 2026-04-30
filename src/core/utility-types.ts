/** Recursively make all properties optional */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ConfigChangeListener<T> = (newValue: T, oldValue: T) => void | Promise<void>;
export type Unsubscribe = () => void;
