// Low-level API client with unified error handling

import type { ApiResponse, ApiError } from '../types/api'

const API_BASE = '/api'

export class ApiClientError extends Error {
  status?: number
  details?: any

  constructor(message: string, status?: number, details?: any) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.details = details
  }
}

/**
 * Make an API request with proper error handling
 */
export async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    })

    // Check response status
    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`
      let errorDetails: any = null

      try {
        const errorData = await res.json()
        errorMessage = errorData.message || errorData.error || errorMessage
        errorDetails = errorData
      } catch {
        // If response is not JSON, use status text
        errorMessage = res.statusText || errorMessage
      }

      throw new ApiClientError(errorMessage, res.status, errorDetails)
    }

    // Parse response
    const data = await res.json()
    return { data, error: null }
  } catch (e: any) {
    if (e instanceof ApiClientError) {
      return { data: null, error: e.message }
    }
    return { data: null, error: e.message || 'Network error' }
  }
}

/**
 * GET request
 */
export async function apiGet<T>(url: string): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { method: 'GET' })
}

/**
 * POST request
 */
export async function apiPost<T>(
  url: string,
  body?: any
): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  })
}

/**
 * PUT request
 */
export async function apiPut<T>(
  url: string,
  body?: any
): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined
  })
}

/**
 * DELETE request
 */
export async function apiDelete<T>(url: string): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { method: 'DELETE' })
}
