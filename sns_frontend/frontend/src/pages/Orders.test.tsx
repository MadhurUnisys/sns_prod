import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuddyDashboard } from './BuddyPortal'
import { OrderHistory } from './Orders'

const auth = vi.hoisted(() => ({ current: { role: 'customer', user: { id: 'customer-1', name: 'Jane Customer' }, loading: false } }))
vi.mock('../state/AppState', () => ({ useAuth: () => auth.current }))
vi.mock('../services/realtime', () => ({ createBuddyRealtime: () => () => undefined, createOrderRealtime: () => () => undefined }))

const order = (number: number) => ({
  _id: `order-${number}`,
  orderId: `ORDR0000${number}`,
  status: 'pending',
  createdAt: `2026-01-01T00:00:0${number}.000Z`,
  totalPrice: 45,
  buddy: { _id: 'buddy-1', name: 'Asha' },
  items: [{ product: 'p-1', name: 'Milk', quantity: 1, price: 45 }],
})
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const firstPage = { orders: [order(3), order(2)], pageInfo: { hasMore: true, nextCursor: '2026-01-01T00:00:02.000Z' } }
const lastPage = { orders: [order(1)], pageInfo: { hasMore: false, nextCursor: null } }

function stubOrderPages() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/buddies/me/inventory')) return Promise.resolve(json({ inventory: [] }))
    return Promise.resolve(json(url.includes('cursor=') ? lastPage : firstPage))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const orderUrls = (fetchMock: ReturnType<typeof stubOrderPages>) => fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/orders'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('paginated order lists', () => {
  it('shows Load more on the customer order history and refetches with the cursor', async () => {
    auth.current = { role: 'customer', user: { id: 'customer-1', name: 'Jane Customer' }, loading: false }
    const fetchMock = stubOrderPages()
    render(<MemoryRouter><OrderHistory /></MemoryRouter>)

    expect(await screen.findByText('ORDER · ORDR00003')).toBeInTheDocument()
    expect(screen.queryByText('ORDER · ORDR00001')).not.toBeInTheDocument()
    expect(orderUrls(fetchMock)).toEqual(['/orders?limit=25'])

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('ORDER · ORDR00001')).toBeInTheDocument()
    expect(screen.getByText('ORDER · ORDR00003')).toBeInTheDocument()
    expect(orderUrls(fetchMock)).toEqual(['/orders?limit=25', `/orders?limit=25&cursor=${encodeURIComponent('2026-01-01T00:00:02.000Z')}`])
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('does not show Load more when the server reports no further page', async () => {
    auth.current = { role: 'customer', user: { id: 'customer-1', name: 'Jane Customer' }, loading: false }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(lastPage))))
    render(<MemoryRouter><OrderHistory /></MemoryRouter>)

    expect(await screen.findByText('ORDER · ORDR00001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('shows Load more on the Buddy portal and appends the next page', async () => {
    auth.current = { role: 'buddy', user: { id: 'buddy-1', name: 'Asha' }, loading: false }
    const fetchMock = stubOrderPages()
    render(<MemoryRouter><BuddyDashboard /></MemoryRouter>)

    expect(await screen.findByText('ORDER · ORDR00003')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('ORDER · ORDR00001')).toBeInTheDocument()
    expect(screen.getByText('ORDER · ORDR00002')).toBeInTheDocument()
    expect(orderUrls(fetchMock).at(-1)).toBe(`/orders?limit=25&cursor=${encodeURIComponent('2026-01-01T00:00:02.000Z')}`)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
