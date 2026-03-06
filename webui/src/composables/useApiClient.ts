// Composable for API calls with per-request loading/error state

import { ref, type Ref } from 'vue'
import type { ApiResponse } from '../types/api'

export interface UseApiClientReturn<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  execute: (...args: any[]) => Promise<T | null>
  reset: () => void
}

/**
 * Create an API client composable with independent loading/error state
 *
 * @param apiFunction - The API function to wrap
 * @returns Object with data, loading, error refs and execute function
 *
 * @example
 * const { data, loading, error, execute } = useApiClient(
 *   (id: string) => apiGet<Session>(`/sessions/${id}`)
 * )
 * await execute('session-123')
 */
export function useApiClient<T>(
  apiFunction: (...args: any[]) => Promise<ApiResponse<T>>
): UseApiClientReturn<T> {
  const data = ref<T | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const execute = async (...args: any[]): Promise<T | null> => {
    loading.value = true
    error.value = null

    try {
      const response = await apiFunction(...args)

      if (response.error) {
        error.value = response.error
        data.value = null
        return null
      }

      data.value = response.data
      return response.data
    } catch (e: any) {
      error.value = e.message || 'Unknown error'
      data.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  const reset = () => {
    data.value = null
    loading.value = false
    error.value = null
  }

  return {
    data: data as Ref<T | null>,
    loading,
    error,
    execute,
    reset
  }
}
