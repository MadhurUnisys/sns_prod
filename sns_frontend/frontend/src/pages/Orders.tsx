import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, MapPin, PackageCheck, RefreshCw, ShoppingBag } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { EmptyState, PageHeading } from '../components/StorefrontParts'
import { MapPreview } from '../components/MapPreview'
import { api, formatApiError, formatDeliveryWindow } from '../services/api'
import { createOrderRealtime } from '../services/realtime'
import { useAuth } from '../state/AppState'
import type { Order, User } from '../types'

function displayStatus(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}

function statusTone(value: string) {
  const status = value.toLocaleLowerCase()
  if (status.includes('deliver')) return 'status-pill--green'
  if (status.includes('cancel') || status.includes('fail')) return 'status-pill--muted'
  if (status.includes('pending') || status.includes('assign')) return 'status-pill--gold'
  return 'status-pill--blue'
}

export function OrderHistory() {
  const { role, user, loading } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const page = await api.orders()
      setOrders(page.orders)
      setNextCursor(page.nextCursor)
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (!loading && user && role === 'customer') void refresh()
  }, [loading, refresh, role, user])
  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError('')
    try {
      const page = await api.orders(nextCursor)
      setOrders((current) => [...current, ...page.orders])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setLoadingMore(false)
    }
  }
  if (loading) return <div className="page-loading" role="status">Loading your account…</div>
  if (!user || role !== 'customer') return <Navigate to="/login" replace />

  return (
    <main className="page-wrap shell">
      <PageHeading eyebrow="YOUR BUDDYYAA JOURNEY" title="My orders"><p>Orders placed with Buddyyaa, straight from the people fulfilling them.</p></PageHeading>
      {error && <div className="inline-error"><span>{error}</span><button className="button button--outline" onClick={() => void refresh()} type="button"><RefreshCw size={15} /> Try again</button></div>}
      {busy ? <OrderSkeletons /> : orders.length === 0 && !error
        ? <EmptyState icon={<ShoppingBag size={25} />} title="No orders just yet" message="When you place your first order, you’ll find its progress and details here." action={<Link to="/" className="button button--gold">Explore fresh picks <ArrowRight size={16} /></Link>} />
        : <div className="orders-list">{orders.map((order) => <OrderCard key={order.id} order={order} />)}{nextCursor && <button className="button button--outline" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? 'Loading…' : 'Load more'}</button>}</div>}
    </main>
  )
}

function OrderSkeletons() {
  return <div className="orders-list" aria-label="Loading orders"><div className="order-skeleton" /><div className="order-skeleton" /><div className="order-skeleton" /></div>
}

function OrderCard({ order }: { order: Order }) {
  return (
    <motion.article className="order-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="order-card__top"><div><span className="order-ref">ORDER · {order.orderNumber ?? order.id}</span>{order.createdAt && <span className="order-date"><CalendarDays size={13} /> {new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}</div><span className={`status-pill ${statusTone(order.status)}`}>{displayStatus(order.status)}</span></div>
      <div className="order-card__content">
        <div className="order-card__items">{order.items.slice(0, 3).map((item, index) => <span key={`${order.id}-${item.productId}-${index}`}>{item.quantity} × {item.name}</span>)}{order.items.length > 3 && <small>and {order.items.length - 3} more item types</small>}</div>
        <div className="order-card__delivery">{order.buddy && <span><span className="buddy-avatar">{order.buddy.name.slice(0, 1)}</span> Fulfilled by {order.buddy.name}</span>}{order.address && <span><MapPin size={14} /> {order.address}</span>}{order.scheduledWindow && <span><Clock3 size={14} /> Scheduled · {formatDeliveryWindow(order.scheduledWindow)}</span>}</div>
      </div>
      <div className="order-card__bottom"><strong>{order.total !== undefined ? `₹${order.total.toFixed(2)}` : 'Total confirmed by Buddyyaa'}</strong><Link to={`/orders/${encodeURIComponent(order.id)}`}>Track order <ArrowRight size={15} /></Link></div>
    </motion.article>
  )
}

export function OrderTracking() {
  const { id = '' } = useParams()
  const { role, user, loading } = useAuth()
  const [order, setOrder] = useState<Order | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [persisted, tracking] = await Promise.all([api.order(id), api.tracking(id)])
      setOrder({
        ...persisted,
        buddyLocation: tracking.buddyLocation ?? persisted.buddyLocation,
        destination: tracking.destination ?? persisted.destination,
        statusHistory: tracking.statusHistory ?? persisted.statusHistory,
      })
      setError('')
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setBusy(false)
    }
  }, [id])

  useEffect(() => {
    if (loading || !user || role !== 'customer') return
    setBusy(true)
    void refresh()
  }, [loading, refresh, role, user])

  useEffect(() => {
    if (!user || role !== 'customer' || !id) return
    return createOrderRealtime(id, () => { void refresh() }, setConnected)
  }, [id, refresh, role, user])

  if (loading) return <div className="page-loading" role="status">Loading your account…</div>
  if (!user || role !== 'customer') return <Navigate to="/login" replace />

  return (
    <main className="page-wrap shell tracking-page">
      <Link to="/orders" className="back-link"><ArrowLeft size={16} /> All orders</Link>
      {busy ? <div className="tracking-skeleton" /> : error ? <div className="catalogue-error"><strong>We couldn’t load this order.</strong><span>{error}</span><button className="button button--outline" onClick={() => { setBusy(true); void refresh() }} type="button"><RefreshCw size={15} /> Retry</button></div> : order && <>
        <div className="tracking-header">
          <div><span className="eyebrow">ORDER TRACKING</span><h1>Your order is in good hands<span className="title-period">.</span></h1><p>Order <strong>#{order.orderNumber ?? order.id}</strong> · {order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Placed with Buddyyaa'}</p></div>
          <span className={`status-pill status-pill--large ${statusTone(order.status)}`}>{displayStatus(order.status)}</span>
        </div>
        <div className="tracking-layout">
          <section className="tracking-main">
            <div className="tracking-map-card"><div className="map-card-heading"><div><MapPin size={18} /><strong>Your delivery area</strong></div><span className={`connection-indicator${connected ? ' is-connected' : ''}`}><i />{connected ? 'Live updates connected' : 'Showing latest saved update'}</span></div><MapPreview current={order.buddyLocation} destination={order.destination} /></div>
            <div className="status-history-card"><div className="card-title-row"><PackageCheck size={18} /><h2>Order progress</h2></div>
              {order.statusHistory?.length
                ? <ol className="status-history">{order.statusHistory.map((event, index) => <li key={`${event.status}-${event.createdAt ?? index}`}><span className="status-history__dot" /><div><strong>{displayStatus(event.status)}</strong>{event.createdAt && <small>{new Date(event.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small>}</div></li>)}</ol>
                : <div className="current-status"><span className="status-history__dot" /><div><small>CURRENT STATUS FROM BUDDYYAA</small><strong>{displayStatus(order.status)}</strong><p>We refresh this view from the saved order and tracking records.</p></div></div>}
            </div>
          </section>
          <aside className="tracking-aside">
            <div className="tracking-aside__buddy"><span className="buddy-avatar buddy-avatar--large">{order.buddy?.name.slice(0, 1) ?? 'B'}</span><div><small>YOUR LOCAL BUDDY</small><strong>{order.buddy?.name ?? 'Assigned by Buddyyaa'}</strong><span>One Buddy, fulfilling your complete order.</span></div></div>
            <div className="tracking-aside__address"><small>DELIVERY ADDRESS</small><p>{order.address ?? 'Address details were not returned with this order.'}</p></div>
            <div className="tracking-aside__items"><small>IN THIS ORDER</small>{order.items.map((item, index) => <div key={`${item.productId}-${index}`}><span>{item.quantity} × {item.name}</span><strong>{item.price !== undefined ? `₹${(item.price * item.quantity).toFixed(2)}` : 'Price from order'}</strong></div>)}</div>
            <div className="tracking-aside__total"><span>Order total</span><strong>{order.total !== undefined ? `₹${order.total.toFixed(2)}` : 'Confirmed by server'}</strong></div>
            <p className="tracking-aside__note">Buddyyaa shares only the tracking information authorized for this order.</p>
          </aside>
        </div>
      </>}
    </main>
  )
}

export function ProfilePage() {
  const { user, role, loading, updateUser, logout } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [address, setAddress] = useState(user?.address ?? '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setName(user?.name ?? ''); setAddress(user?.address ?? '') }, [user])
  if (loading) return <div className="page-loading" role="status">Loading your account…</div>
  if (!user || role !== 'customer') return <Navigate to="/login" replace />

  async function saveProfile(event: FormEvent) {
    if (!user) return
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const body = await api.updateProfile({ name: name.trim(), address: address.trim() })
      const root = body && typeof body === 'object' ? body as Record<string, unknown> : {}
      const source = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root
      const updated: User = {
        ...user,
        name: typeof source.name === 'string' ? source.name : name.trim(),
        address: typeof source.address === 'string' ? source.address : address.trim(),
      }
      updateUser(updated)
      setMessage('Your profile was updated.')
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-wrap shell profile-page">
      <PageHeading eyebrow="YOUR ACCOUNT" title={`Hello, ${user.name.split(' ')[0]}`}><p>Keep your delivery details and account information up to date.</p></PageHeading>
      <div className="profile-layout">
        <section className="profile-card">
          <div className="profile-card__heading"><span className="profile-avatar">{user.name.slice(0, 1)}</span><div><span className="eyebrow">CUSTOMER PROFILE</span><h2>{user.name}</h2><p>{user.phone ?? user.email ?? 'Buddyyaa customer'}</p></div></div>
          <form className="form-stack" onSubmit={(event) => void saveProfile(event)}>
            <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>Delivery address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Your home or preferred delivery address" /></label>
            {message && <p className="form-success" role="status">{message}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button--gold" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save changes'} <ArrowRight size={16} /></button>
          </form>
        </section>
        <section className="profile-shortcuts"><span className="eyebrow">YOUR BUDDYYAA</span><h2>Stay close to your orders.</h2><p>See order progress and delivery details directly from your local Buddy.</p><Link className="button button--dark" to="/orders">View my orders <ArrowRight size={16} /></Link><button className="profile-signout" onClick={logout} type="button">Sign out of Buddyyaa</button></section>
      </div>
    </main>
  )
}
