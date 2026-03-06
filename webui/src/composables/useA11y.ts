// Accessibility utility functions

import { type Ref } from 'vue'

/**
 * Generate a unique ID for accessibility attributes
 */
export function useUniqueId(prefix: string = 'a11y'): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Announce message to screen readers
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite') {
  const announcement = document.createElement('div')
  announcement.setAttribute('role', 'status')
  announcement.setAttribute('aria-live', priority)
  announcement.setAttribute('aria-atomic', 'true')
  announcement.className = 'sr-only'
  announcement.textContent = message

  document.body.appendChild(announcement)

  // Remove after announcement
  setTimeout(() => {
    document.body.removeChild(announcement)
  }, 1000)
}

/**
 * Focus trap for modals and dialogs
 */
export function useFocusTrap(containerRef: Ref<HTMLElement | null>) {
  const focusableElements = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  let firstFocusable: HTMLElement | null = null
  let lastFocusable: HTMLElement | null = null

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !containerRef.value) return

    const focusables = Array.from(
      containerRef.value.querySelectorAll<HTMLElement>(focusableElements)
    ).filter(el => !el.hasAttribute('disabled'))

    firstFocusable = focusables[0] || null
    lastFocusable = focusables[focusables.length - 1] || null

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        lastFocusable?.focus()
        e.preventDefault()
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        firstFocusable?.focus()
        e.preventDefault()
      }
    }
  }

  const activate = () => {
    if (!containerRef.value) return

    const focusables = Array.from(
      containerRef.value.querySelectorAll<HTMLElement>(focusableElements)
    ).filter(el => !el.hasAttribute('disabled'))

    firstFocusable = focusables[0] || null
    firstFocusable?.focus()

    document.addEventListener('keydown', handleKeyDown)
  }

  const deactivate = () => {
    document.removeEventListener('keydown', handleKeyDown)
  }

  return {
    activate,
    deactivate
  }
}

/**
 * Manage focus restoration
 */
export function useFocusRestore() {
  let previousActiveElement: HTMLElement | null = null

  const save = () => {
    previousActiveElement = document.activeElement as HTMLElement
  }

  const restore = () => {
    previousActiveElement?.focus()
    previousActiveElement = null
  }

  return {
    save,
    restore
  }
}

/**
 * Check if element is visible to screen readers
 */
export function isVisibleToScreenReader(element: HTMLElement): boolean {
  return (
    element.offsetWidth > 0 &&
    element.offsetHeight > 0 &&
    window.getComputedStyle(element).visibility !== 'hidden' &&
    !element.hasAttribute('aria-hidden')
  )
}

/**
 * Add screen reader only class to global styles
 */
export function injectScreenReaderStyles() {
  if (document.getElementById('a11y-sr-only-styles')) return

  const style = document.createElement('style')
  style.id = 'a11y-sr-only-styles'
  style.textContent = `
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
  `
  document.head.appendChild(style)
}
