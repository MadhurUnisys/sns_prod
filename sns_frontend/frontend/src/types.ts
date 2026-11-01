export type AccountRole = 'customer' | 'buddy'
export type DeliveryMode = 'normal' | 'ufd'
export type DeliveryTiming = 'NOW' | 'SCHEDULED'

export interface Coordinates {
  latitude: number
  longitude: number
}

export interface DeliveryLocation extends Coordinates {
  address: string
}

export interface User {
  id: string
  name: string
  email?: string
  phone?: string
  role?: string
  address?: string
}

export interface Category {
  id: string
  name: string
  slug?: string
  imageUrl?: string
}

export interface Product {
  id: string
  name: string
  unit: string
  price: number
  salePrice?: number
  imageUrl?: string
  categoryId?: string
  categoryName?: string
  availableQuantity?: number
}

export interface BuddySummary {
  id: string
  name: string
  phone?: string
  location?: Coordinates
}

export interface OrderItem {
  productId: string
  name: string
  unit: string
  quantity: number
  price?: number
  imageUrl?: string
}

export interface Order {
  id: string
  orderNumber?: string
  status: string
  createdAt?: string
  items: OrderItem[]
  total?: number
  address?: string
  destination?: Coordinates
  buddy?: BuddySummary
  buddyId?: string
  buddyLocation?: Coordinates
  allowedStatuses?: string[]
  statusHistory?: Array<{ status: string; createdAt?: string }>
  deliveryTiming?: DeliveryTiming
  scheduledWindow?: DeliveryWindow
}

export interface DeliveryWindow {
  start: string
  end: string
}

export interface DeliverySlot extends DeliveryWindow {
  id: string
  date: string
  label: string
}

export interface UfdCatalogue {
  buddy: BuddySummary
  products: Product[]
}

export interface BuddyInventoryItem {
  id: string
  productId: string
  productName: string
  unit: string
  availableQuantity: number
  reservedQuantity: number
  isActive: boolean
}

export interface ApiEnvelope<T> {
  data?: T
  success?: boolean
  message?: string
}
