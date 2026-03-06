// Throttle utility
import { ref, type Ref } from 'vue'

/**
 * Throttle a function call
 * @param func - Function to throttle
 * @param limit - Time limit in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false

  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }
}

/**
 * Throttle a function with Vue composable pattern
 * @param fn - Function to throttle
 * @param limit - Time limit in milliseconds
 * @returns Object with throttled function
 */
export function useThrottleFn<T extends (...args: any[]) => any>(
  fn: T,
  limit: number = 300
) {
  let inThrottle = false

  const throttledFn = (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }

  return {
    throttledFn
  }
}

/**
 * Throttle a ref value
 * @param value - Ref to throttle
 * @param limit - Time limit in milliseconds
 * @returns Throttled ref
 */
export function useThrottle<T>(value: Ref<T>, limit: number): Ref<T> {
  const throttledValue = ref(value.value) as Ref<T>
  let lastUpdate = 0

  const updateValue = (newValue: T) => {
    const now = Date.now()
    if (now - lastUpdate >= limit) {
      throttledValue.value = newValue
      lastUpdate = now
    }
  }

  // Watch for changes
  const stopWatch = () => {
    // Cleanup function
  }

  return throttledValue
}
