import type { Ref } from 'vue'

export async function withRequestState<T>(
  loading: Ref<boolean>,
  error: Ref<string | null>,
  task: () => Promise<T>
): Promise<T> {
  loading.value = true
  error.value = null
  try {
    return await task()
  } finally {
    loading.value = false
  }
}
