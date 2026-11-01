import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Checkout } from './Checkout'

const state = vi.hoisted(() => {
  const product = { id: 'p-tomato', name: 'Tomato', unit: '1 kg', price: 38, salePrice: 34 }
  return {
    auth: { role: 'customer', user: { id: 'customer-1', name: 'Jane Customer' }, loading: false },
    cart: { state: { mode: 'normal', normal: [{ product, quantity: 2 }], ufd: [] }, refreshProducts: () => undefined, clear: () => undefined, setQuantity: () => undefined, remove: () => undefined },
    delivery: { location: { latitude: 19.8762, longitude: 75.3433, address: 'Kranti Chowk' }, setLocation: () => undefined },
  }
})
vi.mock('../state/AppState', () => ({ useAuth: () => state.auth, useCart: () => state.cart, useDeliveryLocation: () => state.delivery }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const slots = [
  { id: '2026-11-03_0700-0900', date: '2026-11-03', label: '7:00 – 9:00 AM', start: '2026-11-03T01:30:00.000Z', end: '2026-11-03T03:30:00.000Z' },
  { id: '2026-11-03_1600-1900', date: '2026-11-03', label: '4:00 – 7:00 PM', start: '2026-11-03T10:30:00.000Z', end: '2026-11-03T13:30:00.000Z' },
]

function stubApi() {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/delivery-slots')) return Promise.resolve(json({ timeZone: 'Asia/Kolkata', slots }))
    if (url.includes('/orders/create')) return Promise.resolve(json({ order: { _id: 'order-9', status: 'pending', items: [] } }, 201))
    return Promise.resolve(json({ products: [{ _id: 'p-tomato', name: 'Tomato', price: 38, discountPrice: 34, quantity: '1 kg' }] }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const createBody = (fetchMock: ReturnType<typeof stubApi>) => {
  const call = fetchMock.mock.calls.find(([input]) => String(input).includes('/orders/create'))
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>
}
const renderCheckout = () => render(<MemoryRouter initialEntries={['/checkout']}><Routes><Route path="/checkout" element={<Checkout />} /><Route path="/orders/:id" element={<p>Order page</p>} /></Routes></MemoryRouter>)

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('checkout delivery timing', () => {
  it('places an immediate order by default without slot fields', async () => {
    const fetchMock = stubApi()
    renderCheckout()
    expect(await screen.findByText('Active catalogue prices refreshed.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'As soon as possible' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: /Place order/ }))

    expect(await screen.findByText('Order page')).toBeInTheDocument()
    const body = createBody(fetchMock)
    expect(body.deliveryMode).toBeUndefined()
    expect(body.scheduledSlotId).toBeUndefined()
  })

  it('lets the customer pick a server-provided slot and sends it with the order', async () => {
    const fetchMock = stubApi()
    renderCheckout()
    expect(await screen.findByText('Active catalogue prices refreshed.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Schedule for later' }))
    const picker = await screen.findByRole('combobox', { name: 'Delivery slot' })
    expect(await screen.findByRole('option', { name: /Tue, 3 Nov · 4:00 – 7:00 PM/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Place order/ })).toBeDisabled()

    await userEvent.selectOptions(picker, '2026-11-03_1600-1900')
    await userEvent.click(screen.getByRole('button', { name: /Place order/ }))

    expect(await screen.findByText('Order page')).toBeInTheDocument()
    const body = createBody(fetchMock)
    expect(body.deliveryMode).toBe('SCHEDULED')
    expect(body.scheduledSlotId).toBe('2026-11-03_1600-1900')
  })
})
