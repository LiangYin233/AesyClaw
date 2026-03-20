// Mobile detection and responsive utilities
import { ref, onMounted, onUnmounted } from 'vue'
import { throttle } from './useThrottle'

/**
 * Detect if device is mobile based on screen width
 * @param breakpoint - Width breakpoint in pixels (default: 768)
 * @returns Reactive mobile state
 */
export function useMediaQuery(breakpoint: number = 768) {
  const isMobile = ref(false)
  let throttledCheck: (() => void) | null = null

  const checkMobile = () => {
    isMobile.value = window.innerWidth < breakpoint
  }

  onMounted(() => {
    checkMobile()
    throttledCheck = throttle(checkMobile, 200)
    window.addEventListener('resize', throttledCheck)
  })

  onUnmounted(() => {
    if (throttledCheck) {
      window.removeEventListener('resize', throttledCheck)
    }
  })

  return {
    isMobile
  }
}

/**
 * Get current window size
 * @returns Reactive window dimensions
 */
export function useWindowSize() {
  const width = ref(0)
  const height = ref(0)
  let throttledUpdate: (() => void) | null = null

  const update = () => {
    width.value = window.innerWidth
    height.value = window.innerHeight
  }

  onMounted(() => {
    update()
    throttledUpdate = throttle(update, 200)
    window.addEventListener('resize', throttledUpdate)
  })

  onUnmounted(() => {
    if (throttledUpdate) {
      window.removeEventListener('resize', throttledUpdate)
    }
  })

  return {
    width,
    height
  }
}

/**
 * Detect if user prefers reduced motion
 * @returns Reactive reduced motion preference
 */
export function usePrefersReducedMotion() {
  const prefersReducedMotion = ref(false)
  let mediaQuery: MediaQueryList | null = null
  const handler = (e: MediaQueryListEvent) => {
    prefersReducedMotion.value = e.matches
  }

  onMounted(() => {
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.value = mediaQuery.matches

    mediaQuery.addEventListener('change', handler)
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', handler)
  })

  return {
    prefersReducedMotion
  }
}
