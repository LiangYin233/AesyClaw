// Throttle utility
import { ref, watch, type Ref } from 'vue'

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
  let timeoutId: number | null = null

  watch(
    value,
    (newValue) => {
      const now = Date.now()
      const remaining = limit - (now - lastUpdate)

      if (remaining <= 0) {
        throttledValue.value = newValue
        lastUpdate = now
        return
      }

      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }

      timeoutId = window.setTimeout(() => {
        throttledValue.value = newValue
        lastUpdate = Date.now()
      }, remaining)
    },
    { flush: 'sync' }
  )

  return throttledValue
}
