// Mobile detection and responsive utilities
import { ref, onMounted, onUnmounted } from 'vue'
import { useThrottle } from './useThrottle'

/**
 * Detect if device is mobile based on screen width
 * @param breakpoint - Width breakpoint in pixels (default: 768)
 * @returns Reactive mobile state
 */
export function useMediaQuery(breakpoint: number = 768) {
  const isMobile = ref(false)

  const checkMobile = () => {
    isMobile.value = window.innerWidth < breakpoint
  }

  onMounted(() => {
    checkMobile()
    const throttledCheck = useThrottle(checkMobile, 200)
    window.addEventListener('resize', throttledCheck)

    onUnmounted(() => {
      window.removeEventListener('resize', throttledCheck)
    })
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

  const update = () => {
    width.value = window.innerWidth
    height.value = window.innerHeight
  }

  onMounted(() => {
    update()
    const throttledUpdate = useThrottle(update, 200)
    window.addEventListener('resize', throttledUpdate)

    onUnmounted(() => {
      window.removeEventListener('resize', throttledUpdate)
    })
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

  onMounted(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.value = mediaQuery.matches

    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion.value = e.matches
    }

    mediaQuery.addEventListener('change', handler)

    onUnmounted(() => {
      mediaQuery.removeEventListener('change', handler)
    })
  })

  return {
    prefersReducedMotion
  }
}
