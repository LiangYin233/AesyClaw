// Low-level API client with unified error handling

import type { ApiResponse } from '../types/api'
import router from '../router'
import { normalizeToken } from './auth'

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

function getCurrentToken(): string | null {
  const routeToken = normalizeToken(router.currentRoute.value.query.token)
  if (routeToken) {
    return routeToken
  }

  const url = new URL(window.location.href)
  return normalizeToken(url.searchParams.get('token'))
}

function buildApiUrl(url: string): string {
  const requestUrl = new URL(`${API_BASE}${url}`, window.location.origin)
  const token = getCurrentToken()

  if (token) {
    requestUrl.searchParams.set('token', token)
  }

  return `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`
}

function redirectToUnauthorized(reason: 'missing' | 'invalid') {
  if (router.currentRoute.value.name === 'unauthorized') {
    return
  }

  void router.replace({
    name: 'unauthorized',
    query: { reason }
  })
}

/**
 * Make an API request with proper error handling
 */
export async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(buildApiUrl(url), {
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

      if (res.status === 401) {
        redirectToUnauthorized(getCurrentToken() ? 'invalid' : 'missing')
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
