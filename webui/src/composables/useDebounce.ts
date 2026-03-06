// Debounce utility
import { ref, watch, type Ref } from 'vue'

/**
 * Debounce a function call
 * @param func - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | undefined

  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timeoutId)
    timeoutId = window.setTimeout(() => {
      func.apply(this, args)
    }, delay)
  }
}

/**
 * Debounce a ref value
 * @param value - Ref to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced ref
 */
export function useDebounce<T>(value: Ref<T>, delay: number): Ref<T> {
  const debouncedValue = ref(value.value) as Ref<T>

  watch(value, (newValue) => {
    const timeoutId = window.setTimeout(() => {
      debouncedValue.value = newValue
    }, delay)

    return () => clearTimeout(timeoutId)
  })

  return debouncedValue
}

/**
 * Debounce a function with Vue composable pattern
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Object with debounced function and cancel method
 */
export function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
) {
  let timeoutId: number | undefined

  const debouncedFn = (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = window.setTimeout(() => {
      fn(...args)
    }, delay)
  }

  const cancel = () => {
    clearTimeout(timeoutId)
  }

  return {
    debouncedFn,
    cancel
  }
}
