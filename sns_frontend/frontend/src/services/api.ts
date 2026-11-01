import type {
  AccountRole,
  BuddyInventoryItem,
  Category,
  Coordinates,
  Order,
  Product,
  UfdCatalogue,
  User,
} from '../types'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
const REQUEST_TIMEOUT_MS = 20_000
const REFRESH_TOKEN_KEY = 'buddyyaa-refresh-token'
const ORDER_PAGE_SIZE = 25
let accessToken: string | null = null
let refreshInFlight: Promise<boolean> | null = null

export interface OrderPage {
  orders: Order[]
  nextCursor: string | null
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function productImage(value: unknown): string | undefined {
  const source = firstString(value)
  if (!source) return undefined
  if (/^(https?:|data:image\/|blob:)/i.test(source)) return source
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return undefined
  const base = API_BASE_URL || window.location.origin
  try {
    return new URL(source, base).toString()
  } catch {
    return undefined
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export async function restoreSession(): Promise<boolean> {
  return refreshSession()
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function unwrap(value: unknown): unknown {
  const body = record(value)
  return body.data ?? body.result ?? body
}

function collection(value: unknown): unknown[] {
  const body = record(unwrap(value))
  const items = body.items ?? body.products ?? body.categories ?? body.orders ?? body.inventory ?? body.results
  if (Array.isArray(items)) return items
  const outer = unwrap(value)
  return Array.isArray(outer) ? outer : []
}

export function normalizeCategory(value: unknown): Category {
  const item = record(value)
  return {
    id: String(item.id ?? item._id ?? ''),
    name: firstString(item.name, item.title) ?? 'Category',
    slug: firstString(item.slug),
    imageUrl: firstString(item.imageUrl, item.image, item.thumbnail),
  }
}

export function normalizeProduct(value: unknown): Product {
  const item = record(value)
  const category = record(item.category)
  const price = numberValue(item.price ?? item.sellingPrice ?? item.currentPrice) ?? Number.NaN
  const salePrice = numberValue(item.salePrice ?? item.discountPrice ?? item.discountedPrice)
  const stock = numberValue(item.availableQuantity ?? item.stockQuantity ?? item.stock)
  return {
    id: String(item.id ?? item._id ?? ''),
    name: firstString(item.name, item.title) ?? '',
    unit: firstString(item.unit, item.quantity, item.quantityLabel, item.measure) ?? '',
    price,
    salePrice: salePrice !== undefined && salePrice < price ? salePrice : undefined,
    imageUrl: productImage(item.imageUrl ?? item.image ?? item.thumbnail ?? item.photo),
    categoryId: firstString(item.categoryId, category.id, category._id, item.category),
    categoryName: firstString(item.categoryName, category.name),
    availableQuantity: stock,
  }
}

export function normalizeBuddyInventoryItem(value: unknown): BuddyInventoryItem {
  const item = record(value)
  const product = record(item.product)
  return {
    id: String(item.id ?? item._id ?? ''),
    productId: String(product.id ?? product._id ?? item.productId ?? ''),
    productName: firstString(product.name, item.productName) ?? 'Product',
    unit: firstString(product.quantity, product.unit) ?? '',
    availableQuantity: numberValue(item.availableQuantity) ?? 0,
    reservedQuantity: numberValue(item.reservedQuantity) ?? 0,
    isActive: item.isActive === true,
  }
}

export function normalizeUser(value: unknown): User {
  const outer = record(value)
  const item = record(outer.user ?? outer.account ?? outer.profile ?? outer.customer ?? outer.buddy ?? value)
  return {
    id: String(item.id ?? item._id ?? ''),
    name: firstString(item.name, item.fullName, item.username) ?? 'Buddyyaa member',
    email: firstString(item.email),
    phone: firstString(item.phone, item.mobile),
    role: firstString(item.role, item.userType),
    address: firstString(item.address, record(item.address).formattedAddress),
  }
}

function normalizeBuddy(value: unknown): UfdCatalogue['buddy'] | undefined {
  const item = record(value)
  const location = record(item.location ?? item.coordinates)
  const latitude = numberValue(location.latitude ?? location.lat)
  const longitude = numberValue(location.longitude ?? location.lng ?? location.lon)
  return (item.id ?? item._id) ? {
    id: String(item.id ?? item._id),
    name: firstString(item.name, item.businessName, item.fullName) ?? 'Your nearby Buddy',
    phone: firstString(item.phone),
    location: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined,
  } : undefined
}

export function normalizeOrder(value: unknown): Order {
  const item = record(value)
  const buddy = normalizeBuddy(item.buddy ?? item.assignedBuddy)
  const destination = record(item.destination ?? item.deliveryLocation ?? item.location)
  const tracking = record(item.tracking)
  const buddyLocation = record(item.buddyLocation ?? item.deliveryPersonLocation ?? item.currentLocation ?? tracking.buddyLocation ?? tracking.deliveryPersonLocation ?? tracking.currentLocation ?? tracking.location ?? item.location)
  const coord = (value: Record<string, unknown>): Coordinates | undefined => {
    const latitude = numberValue(value.latitude ?? value.lat)
    const longitude = numberValue(value.longitude ?? value.lng ?? value.lon)
    return latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined
  }
  const orderItems = Array.isArray(item.items) ? item.items : Array.isArray(item.products) ? item.products : []
  const history = item.statusHistory ?? item.history
  const status = firstString(item.status, item.orderStatus) ?? 'unknown'
  const buddyTransitions: Record<string, string[]> = {
    pending: ['cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['arriving', 'out_for_delivery', 'cancelled'],
    arriving: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered'],
    delivered: [],
    cancelled: [],
  }
  return {
    id: String(item._id ?? item.id ?? ''),
    orderNumber: firstString(item.orderId),
    status,
    createdAt: firstString(item.createdAt, item.created_at, item.date),
    items: orderItems.map((entry) => {
      const line = record(entry)
      const product = record(line.product)
      return {
        productId: String(line.productId ?? product.id ?? product._id ?? line.product ?? ''),
        name: firstString(line.name, product.name, line.productName) ?? 'Product',
        unit: firstString(line.unit, product.unit) ?? '',
        quantity: numberValue(line.quantity ?? line.count) ?? 0,
        price: numberValue(line.price ?? line.unitPrice ?? product.price),
        imageUrl: productImage(line.imageUrl ?? product.imageUrl ?? product.image),
      }
    }),
    total: numberValue(item.total ?? item.totalAmount ?? item.grandTotal ?? item.totalPrice),
    address: firstString(item.address, item.deliveryAddress, item.deliveryLocation, record(item.deliveryLocation).address),
    destination: coord(destination),
    buddy,
    buddyId: firstString(item.buddyId, buddy?.id),
    buddyLocation: coord(buddyLocation),
    allowedStatuses: Array.isArray(item.allowedStatuses)
      ? item.allowedStatuses.filter((status): status is string => typeof status === 'string')
      : buddyTransitions[status] ?? [],
    statusHistory: Array.isArray(history)
      ? history.map((entry) => {
        const event = record(entry)
        return {
          status: firstString(event.status, event.orderStatus) ?? '',
          createdAt: firstString(event.createdAt, event.timestamp, event.date),
        }
      }).filter((entry) => entry.status)
      : undefined,
  }
}

function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

async function decode(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  const contentType = response.headers.get('content-type')?.toLocaleLowerCase() ?? ''
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    if (response.ok) {
      throw new ApiError(
        'The configured API returned a website page instead of JSON. Check VITE_API_BASE_URL and rebuild.',
        502,
        'INVALID_API_RESPONSE',
      )
    }
    return { message: text.trimStart().startsWith('<') ? undefined : text }
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError('Buddyyaa returned an unreadable API response. Please try again later.', 502, 'INVALID_API_RESPONSE')
  }
}

function errorFrom(response: Response, body: unknown): ApiError {
  const details = record(body)
  const nested = record(details.error)
  const code = firstString(details.code, details.errorCode, nested.code)
  const message = firstString(details.message, nested.message, details.error, details.detail)
  return new ApiError(message ?? `The request failed (${response.status}). Please try again.`, response.status, code)
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  let refreshToken: string | null = null
  try {
    refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    throw new ApiError('Your browser could not access the saved session. Please sign in again.', 0, 'SESSION_STORAGE')
  }
  if (!refreshToken) return false
  refreshInFlight = (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(apiUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem(REFRESH_TOKEN_KEY)
        return false
      }
      if (!response.ok) throw errorFrom(response, await decode(response))
      const body = record(unwrap(await decode(response)))
      const token = firstString(body.accessToken, body.token, record(body.tokens).accessToken)
      const nextRefreshToken = firstString(body.refreshToken, record(body.tokens).refreshToken)
      if (!token) throw new ApiError('The session refresh response did not include an access token.', 502, 'INVALID_REFRESH_RESPONSE')
      setAccessToken(token)
      if (nextRefreshToken) sessionStorage.setItem(REFRESH_TOKEN_KEY, nextRefreshToken)
      return true
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('Session refresh timed out. Check your connection and try again.', 408, 'TIMEOUT')
      }
      throw new ApiError('We could not refresh your Buddyyaa session. Check your internet connection and try again.', 0, 'NETWORK')
    } finally {
      window.clearTimeout(timeout)
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryUnauthorized = true,
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers,
      credentials: 'include',
      signal: options.signal ?? controller.signal,
    })
  } catch (error) {
    window.clearTimeout(timeout)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request took too long. Check your connection and try again.', 408, 'TIMEOUT')
    }
    throw new ApiError('We could not reach Buddyyaa. Check your internet connection and try again.', 0, 'NETWORK')
  } finally {
    window.clearTimeout(timeout)
  }

  const isLoginRequest = path.endsWith('/login')
  if (response.status === 401 && !isLoginRequest) {
    if (retryUnauthorized) {
      const refreshed = await refreshSession()
      if (refreshed) return request<T>(path, options, false)
    }
    setAccessToken(null)
    window.dispatchEvent(new Event('buddyyaa:session-expired'))
  }

  const body = await decode(response)
  if (!response.ok) throw errorFrom(response, body)
  return body as T
}

function normalizedList<T>(body: unknown, normalize: (value: unknown) => T): T[] {
  return collection(body).map(normalize).filter((value) => {
    const id = (value as { id?: string }).id
    if (!id) return false
    const candidate = value as { name?: string; price?: number }
    if ('name' in candidate && !candidate.name?.trim()) return false
    if ('price' in candidate && !Number.isFinite(candidate.price)) return false
    return true
  })
}

export const api = {
  async login(role: AccountRole, credentials: Record<string, string>) {
    const endpoint = role === 'customer' ? '/auth/customer/login' : '/auth/buddy/login'
    const body = record(unwrap(await request<unknown>(endpoint, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }, false)))
    const token = firstString(body.accessToken, body.token, record(body.tokens).accessToken)
    if (!token) throw new ApiError('The sign-in response did not include an access token.', 502, 'INVALID_LOGIN_RESPONSE')
    setAccessToken(token)
    const refreshToken = firstString(body.refreshToken, record(body.tokens).refreshToken)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
    if (refreshToken) sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    const candidate = body.user ?? body.account ?? body.profile ?? body.customer ?? body.buddy
    const user = candidate ? normalizeUser(candidate) : normalizeUser(await api.me())
    return { user, role, token }
  },

  me: () => request<unknown>('/auth/me').then((body) => unwrap(body)),

  async logout() {
    setAccessToken(null)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  },

  async products() {
    const body = await request<unknown>('/products')
    return normalizedList(body, normalizeProduct)
  },

  async categories() {
    const body = await request<unknown>('/categories')
    return normalizedList(body, normalizeCategory)
  },

  async ufdCatalogue(location: Coordinates): Promise<UfdCatalogue> {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
    })
    const body = record(unwrap(await request<unknown>(`/products/ufd?${params}`)))
    const buddy = normalizeBuddy(body.buddy ?? body.selectedBuddy ?? body.nearestBuddy ?? {
      id: body.buddyId ?? body.selectedBuddyId,
      name: body.buddyName,
    })
    if (!buddy) throw new ApiError('The UFD response did not include its selected Buddy.', 502, 'INVALID_UFD_RESPONSE')
    return { buddy, products: normalizedList(body.products ?? body.items ?? body, normalizeProduct) }
  },

  async createOrder(input: {
    deliveryType: 'NORMAL' | 'UFD'
    items: Array<{ productId: string; quantity: number }>
    deliveryLocation: Coordinates & { address: string }
    selectedBuddyId?: string
    idempotencyKey: string
  }) {
    const body = await request<unknown>('/orders/create', {
      method: 'POST',
      body: JSON.stringify({
        deliveryType: input.deliveryType,
        items: input.items,
        deliveryLocation: input.deliveryLocation,
        ...(input.deliveryType === 'UFD' && input.selectedBuddyId ? { selectedBuddyId: input.selectedBuddyId } : {}),
        idempotencyKey: input.idempotencyKey,
      }),
    })
    const result = record(unwrap(body))
    const order = normalizeOrder(result.order ?? result)
    if (!order.id) throw new ApiError('The server response did not include an order reference.', 502, 'INVALID_ORDER_RESPONSE')
    return order
  },

  async orders(cursor?: string): Promise<OrderPage> {
    const params = new URLSearchParams({ limit: String(ORDER_PAGE_SIZE) })
    if (cursor) params.set('cursor', cursor)
    const body = await request<unknown>(`/orders?${params}`)
    const pageInfo = record(record(unwrap(body)).pageInfo)
    const nextCursor = pageInfo.hasMore === true ? firstString(pageInfo.nextCursor) ?? null : null
    return { orders: normalizedList(body, normalizeOrder), nextCursor }
  },

  async buddyInventory() {
    const body = await request<unknown>('/buddies/me/inventory')
    return normalizedList(body, normalizeBuddyInventoryItem)
  },

  async updateBuddyInventory(productId: string, availableQuantity: number) {
    const body = await request<unknown>('/buddies/me/inventory', {
      method: 'PATCH',
      body: JSON.stringify({ productId, availableQuantity }),
    })
    const result = record(unwrap(body))
    return normalizeBuddyInventoryItem(result.inventory ?? result)
  },

  async order(id: string) {
    const body = await request<unknown>(`/orders/${encodeURIComponent(id)}`)
    const result = record(unwrap(body))
    return normalizeOrder(result.order ?? result)
  },

  acceptOrder(orderId: string) {
    return request<unknown>('/orders/confirm', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    })
  },

  updateOrderStatus(orderId: string, status: string) {
    return request<unknown>(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },

  updateOrderLocation(orderId: string, location: Coordinates) {
    return request<unknown>(`/orders/${encodeURIComponent(orderId)}/location`, {
      method: 'PATCH',
      body: JSON.stringify(location),
    })
  },

  async tracking(orderId: string) {
    const body = await request<unknown>(`/orders/${encodeURIComponent(orderId)}/tracking`)
    const result = record(unwrap(body))
    return normalizeOrder(result.tracking ?? result)
  },

  updateProfile(input: Partial<User>) {
    return request<unknown>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
}

export function formatApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.'
  if (error.status === 401) return error.code === 'INVALID_CREDENTIALS'
    ? 'That phone number or password was not recognized.'
    : 'Your session has expired. Please sign in again.'
  if (error.status === 403) return 'This action is not available for your account.'
  if ([409, 422].includes(error.status)) return error.message || 'Stock or delivery availability changed. Please review your basket.'
  if (error.status >= 500) return 'Buddyyaa is having trouble right now. Please try again shortly.'
  return error.message
}

export function getAdminPanelUrl() {
  const value = import.meta.env.VITE_ADMIN_PANEL_URL?.trim() ?? ''
  if (value.startsWith('/') && !value.startsWith('//')) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}
