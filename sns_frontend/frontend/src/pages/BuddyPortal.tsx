import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  MapPin,
  PackageCheck,
  RefreshCw,
  Route,
  Sprout,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/StorefrontParts'
import { MapPreview } from '../components/MapPreview'
import { api, formatApiError } from '../services/api'
import { createBuddyRealtime, createOrderRealtime } from '../services/realtime'
import { useAuth } from '../state/AppState'
import type { BuddyInventoryItem, Coordinates, Order } from '../types'

function isDelivered(status: string) {
  return /^delivered$/i.test(status.replace(/[_-]+/g, ' ').trim())
}

function isCancelled(status: string) {
  return /^cancelled?$/i.test(status.replace(/[_-]+/g, ' ').trim())
}

function isAwaitingAcceptance(status: string) {
  return /pending|assigned|awaiting|available/i.test(status)
}

function friendly(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}

function metresBetween(a: Coordinates, b: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latitude = radians(b.latitude - a.latitude)
  const longitude = radians(b.longitude - a.longitude)
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export function BuddyDashboard() {
  const { user, role, loading } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [inventory, setInventory] = useState<BuddyInventoryItem[]>([])
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'available' | 'progress' | 'delivered'>('available')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [inventoryBusy, setInventoryBusy] = useState(true)
  const [inventorySaving, setInventorySaving] = useState<string | null>(null)
  const [inventoryError, setInventoryError] = useState('')
  const [inventoryNotice, setInventoryNotice] = useState('')
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
  const refreshInventory = useCallback(async () => {
    setInventoryBusy(true)
    setInventoryError('')
    try {
      const current = await api.buddyInventory()
      setInventory(current)
      setInventoryDrafts(Object.fromEntries(
        current.map((item) => [item.id, String(item.availableQuantity)]),
      ))
    } catch (reason) {
      setInventoryError(formatApiError(reason))
    } finally {
      setInventoryBusy(false)
    }
  }, [])
  useEffect(() => {
    if (!loading && user && role === 'buddy') void refresh()
  }, [loading, refresh, role, user])
  useEffect(() => {
    if (!loading && user && role === 'buddy') void refreshInventory()
  }, [loading, refreshInventory, role, user])
  useEffect(() => {
    if (!user || role !== 'buddy') return
    return createBuddyRealtime(() => { void refresh() })
  }, [refresh, role, user])
  if (loading) return <div className="page-loading" role="status">Loading Buddy portal…</div>
  if (!user || role !== 'buddy') return <Navigate to="/buddy/login" replace />

  const assignedOrders = orders.filter((order) => order.buddyId === user.id)
  const available = assignedOrders.filter((order) => !isDelivered(order.status) && !isCancelled(order.status) && isAwaitingAcceptance(order.status))
  const delivered = assignedOrders.filter((order) => isDelivered(order.status))
  const inProgress = assignedOrders.filter((order) => !isDelivered(order.status) && !isCancelled(order.status) && !isAwaitingAcceptance(order.status))
  const visible = tab === 'available' ? available : tab === 'progress' ? inProgress : delivered

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

  async function saveInventory(item: BuddyInventoryItem) {
    const quantity = Number(inventoryDrafts[item.id])
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      setInventoryError('Enter a non-negative whole-number quantity.')
      return
    }
    setInventorySaving(item.id)
    setInventoryError('')
    setInventoryNotice('')
    try {
      const updated = await api.updateBuddyInventory(item.productId, quantity)
      setInventory((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
      setInventoryDrafts((current) => ({ ...current, [item.id]: String(updated.availableQuantity) }))
      setInventoryNotice(`${item.productName} stock was updated.`)
    } catch (reason) {
      setInventoryError(formatApiError(reason))
    } finally {
      setInventorySaving(null)
    }
  }

  return (
    <main className="buddy-shell">
      <header className="buddy-header"><div className="shell buddy-header__inner"><Link to="/" className="buddy-brand"><span className="buddy-brand__icon"><Sprout size={19} /></span><strong>Buddy<span>yaa</span></strong><i>FOR LOCAL BUDDIES</i></Link><div className="buddy-user"><span className="buddy-avatar">{user.name.slice(0, 1)}</span><span>{user.name}</span></div></div></header>
      <div className="shell buddy-dashboard">
        <div className="buddy-welcome"><div><span className="eyebrow">YOUR NEIGHBORHOOD, IN MOTION</span><h1>Good morning, {user.name.split(' ')[0]}<span className="title-period">.</span></h1><p>Orders assigned to your Buddy account, all in one place.</p></div><button className="button button--outline" onClick={() => void refresh()} type="button" disabled={busy}><RefreshCw size={15} /> Refresh orders</button></div>
        <div className="buddy-metrics"><Metric icon={<Clock3 size={18} />} label="Awaiting you" count={available.length} tone="gold" /><Metric icon={<Route size={18} />} label="In progress" count={inProgress.length} tone="blue" /><Metric icon={<PackageCheck size={18} />} label="Delivered" count={delivered.length} tone="green" /></div>
        <div className="buddy-orders-card">
          <div className="buddy-orders-heading"><div><span className="eyebrow">YOUR FULFILLMENT DESK</span><h2>Orders</h2></div><div className="buddy-tabs" role="tablist" aria-label="Filter Buddy orders">
            <button type="button" role="tab" aria-selected={tab === 'available'} className={tab === 'available' ? 'is-active' : ''} onClick={() => setTab('available')}>Available <span>{available.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'progress'} className={tab === 'progress' ? 'is-active' : ''} onClick={() => setTab('progress')}>In progress <span>{inProgress.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'delivered'} className={tab === 'delivered' ? 'is-active' : ''} onClick={() => setTab('delivered')}>Delivered <span>{delivered.length}</span></button>
          </div></div>
          {error && <div className="inline-error"><span>{error}</span><button className="button button--outline" onClick={() => void refresh()} type="button"><RefreshCw size={15} /> Retry</button></div>}
          {busy ? <div className="buddy-order-skeleton" /> : visible.length === 0 && !error ? <EmptyState icon={<CircleHelp size={24} />} title={tab === 'delivered' ? 'No completed deliveries yet' : tab === 'progress' ? 'Nothing in progress' : 'No orders waiting right now'} message="This list only includes orders returned for your authenticated Buddy account." /> :
            <div className="buddy-order-list">{visible.map((order) => <BuddyOrderRow key={order.id} order={order} />)}</div>}
          {!busy && nextCursor && <div className="buddy-order-list"><button className="button button--outline button--wide" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? 'Loading…' : 'Load more'}</button></div>}
        </div>
        <section className="buddy-orders-card buddy-inventory-card">
          <div className="buddy-orders-heading">
            <div><span className="eyebrow">YOUR PRODUCT AVAILABILITY</span><h2>Inventory</h2></div>
            <button className="button button--outline" onClick={() => void refreshInventory()} type="button" disabled={inventoryBusy}>
              <RefreshCw size={15} /> Refresh stock
            </button>
          </div>
          {inventoryError && <p className="form-error form-error--box" role="alert">{inventoryError}</p>}
          {inventoryNotice && <p className="form-success" role="status">{inventoryNotice}</p>}
          {inventoryBusy ? <div className="buddy-order-skeleton" role="status" /> : inventory.length === 0
            ? <EmptyState icon={<PackageCheck size={24} />} title="No inventory assigned yet" message="Ask an administrator to add products to your Buddy inventory." />
            : <div className="buddy-stock-list">{inventory.map((item) => (
              <form className="buddy-stock-row" key={item.id} onSubmit={(event) => { event.preventDefault(); void saveInventory(item) }}>
                <div className="buddy-stock-row__product">
                  <strong>{item.productName}</strong>
                  <span>{item.unit || 'As listed'} · {item.reservedQuantity} reserved</span>
                  {!item.isActive && <small>This inventory is inactive. Contact an administrator.</small>}
                </div>
                <label>Available units
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={inventoryDrafts[item.id] ?? String(item.availableQuantity)}
                    disabled={!item.isActive || inventorySaving === item.id}
                    onChange={(event) => setInventoryDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                  />
                </label>
                <button className="button button--dark" type="submit" disabled={!item.isActive || inventorySaving === item.id || inventoryDrafts[item.id] === String(item.availableQuantity)}>
                  {inventorySaving === item.id ? 'Saving…' : 'Save stock'}
                </button>
              </form>
            ))}</div>}
        </section>
        <p className="buddy-privacy"><Check size={14} /> Orders and customer details are supplied by the backend only when your Buddy account is authorized.</p>
      </div>
    </main>
  )
}

function Metric({ icon, label, count, tone }: { icon: React.ReactNode; label: string; count: number; tone: string }) {
  return <div className="buddy-metric"><span className={`buddy-metric__icon buddy-metric__icon--${tone}`}>{icon}</span><span><strong>{count}</strong><small>{label}</small></span></div>
}

function BuddyOrderRow({ order }: { order: Order }) {
  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0)
  return <article className="buddy-order-row">
    <div className="buddy-order-row__icon"><PackageCheck size={19} /></div>
    <div className="buddy-order-row__main"><span className="order-ref">ORDER · {order.orderNumber ?? order.id}</span><strong>{totalItems} items · {order.items.slice(0, 2).map((item) => item.name).join(', ')}{order.items.length > 2 ? ` +${order.items.length - 2} more` : ''}</strong><span>{order.address ?? 'Delivery address available in order details'}</span></div>
    <span className={`status-pill ${isDelivered(order.status) ? 'status-pill--green' : isCancelled(order.status) ? 'status-pill--muted' : isAwaitingAcceptance(order.status) ? 'status-pill--gold' : 'status-pill--blue'}`}>{friendly(order.status)}</span>
    {order.total !== undefined && <strong className="buddy-order-row__total">₹{order.total.toFixed(2)}</strong>}
    <Link className="buddy-order-row__link" to={`/buddy/orders/${encodeURIComponent(order.id)}`} aria-label={`Open order ${order.id}`}><ArrowRight size={17} /></Link>
  </article>
}

export function BuddyOrderDetail() {
  const { id = '' } = useParams()
  const { user, role, loading } = useAuth()
  const [order, setOrder] = useState<Order | null>(null)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const watchId = useRef<number | null>(null)
  const lastSent = useRef<Coordinates | null>(null)
  const locationRequestActive = useRef(false)

  const refresh = useCallback(async () => {
    if (!id) return
    setBusy(true)
    setError('')
    try {
      setOrder(await api.order(id))
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setBusy(false)
    }
  }, [id])
  useEffect(() => {
    if (!loading && user && role === 'buddy') void refresh()
  }, [loading, refresh, role, user])
  useEffect(() => {
    if (!user || role !== 'buddy' || !id) return
    return createOrderRealtime(id, () => { void refresh() }, () => undefined)
  }, [id, refresh, role, user])

  const stopSharing = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    setTracking(false)
  }, [])
  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
  }, [])
  const orderStatus = order?.status
  useEffect(() => {
    if (orderStatus && (isDelivered(orderStatus) || isCancelled(orderStatus))) stopSharing()
  }, [orderStatus, stopSharing])

  if (loading) return <div className="page-loading" role="status">Loading order…</div>
  if (!user || role !== 'buddy') return <Navigate to="/buddy/login" replace />

  async function acceptOrder() {
    if (!order || saving || isDelivered(order.status) || isCancelled(order.status)) return
    setSaving(true)
    setError('')
    try {
      await api.acceptOrder(order.id)
      setNotice('Order confirmation was sent to Buddyyaa.')
      await refresh()
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(status: string) {
    if (!order || saving || !order.allowedStatuses?.includes(status)) return
    setSaving(true)
    setError('')
    try {
      await api.updateOrderStatus(order.id, status)
      setNotice('Order status updated.')
      await refresh()
    } catch (reason) {
      setError(formatApiError(reason))
    } finally {
      setSaving(false)
    }
  }

  function startSharing() {
    if (!navigator.geolocation) {
      setError('Location sharing is not available in this browser.')
      return
    }
    setError('')
    setNotice('')
    watchId.current = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        const next = { latitude: coords.latitude, longitude: coords.longitude }
        const last = lastSent.current
        if (locationRequestActive.current || (last && metresBetween(last, next) < 200)) return
        locationRequestActive.current = true
        try {
          if (!order) return
          await api.updateOrderLocation(order.id, next)
          lastSent.current = next
          setNotice('Your latest location was shared with Buddyyaa.')
          setOrder((current) => current ? { ...current, buddyLocation: next } : current)
        } catch (reason) {
          setError(formatApiError(reason))
          stopSharing()
        } finally {
          locationRequestActive.current = false
        }
      },
      (reason) => {
        setError(reason.code === reason.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access in your browser settings to share your delivery position.'
          : 'We could not get a location update. Check your device settings and try again.')
        stopSharing()
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )
    setTracking(true)
  }

  const canAccept = order && !isDelivered(order.status) && !isCancelled(order.status) && isAwaitingAcceptance(order.status)

  return <main className="buddy-shell"><header className="buddy-header"><div className="shell buddy-header__inner"><Link to="/buddy" className="buddy-brand"><span className="buddy-brand__icon"><Sprout size={19} /></span><strong>Buddy<span>yaa</span></strong><i>FOR LOCAL BUDDIES</i></Link><Link className="buddy-user" to="/buddy"><ArrowLeft size={16} /> Back to orders</Link></div></header>
    <section className="shell buddy-detail-page">
      {busy ? <div className="tracking-skeleton" /> : error && !order ? <div className="catalogue-error"><strong>This order isn’t available.</strong><span>{error}</span><Link className="button button--outline" to="/buddy">Return to orders</Link></div> : order && <>
        <div className="buddy-detail-heading"><div><span className="eyebrow">ORDER ASSIGNED TO YOUR BUDDY ACCOUNT</span><h1>Order #{order.orderNumber ?? order.id}<span className="title-period">.</span></h1><span className={`status-pill ${isDelivered(order.status) ? 'status-pill--green' : isAwaitingAcceptance(order.status) ? 'status-pill--gold' : 'status-pill--blue'}`}>{friendly(order.status)}</span></div><button className="button button--outline" disabled={busy} onClick={() => void refresh()} type="button"><RefreshCw size={15} /> Refresh</button></div>
        {error && <p className="form-error form-error--box" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
        <div className="buddy-detail-layout">
          <div className="buddy-detail-main">
            <section className="buddy-detail-card"><div className="card-title-row"><PackageCheck size={18} /><h2>Order items</h2></div>{order.items.map((item, index) => <div className="buddy-detail-item" key={`${item.productId}-${index}`}><div>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>🥬</span>}</div><span><strong>{item.name}</strong><small>{item.unit || 'As listed'} · Quantity {item.quantity}</small></span><strong>{item.price !== undefined ? `₹${(item.price * item.quantity).toFixed(2)}` : 'Server price'}</strong></div>)}<div className="buddy-detail-total"><span>Server-confirmed order total</span><strong>{order.total !== undefined ? `₹${order.total.toFixed(2)}` : 'Not returned'}</strong></div></section>
            <section className="buddy-detail-card"><div className="card-title-row"><MapPin size={18} /><h2>Delivery destination</h2></div><p className="buddy-address">{order.address ?? 'Address details were not returned for this order.'}</p><MapPreview current={order.buddyLocation} destination={order.destination} /></section>
          </div>
          <aside className="buddy-actions-card"><span className="eyebrow">FULFILLMENT ACTIONS</span><h2>Next steps</h2><p>Only status changes allowed by the backend for this order can be selected.</p>
            {canAccept && <button className="button button--gold button--wide" disabled={saving} onClick={() => void acceptOrder()} type="button">{saving ? 'Confirming…' : 'Accept this order'} <Check size={17} /></button>}
            {order.allowedStatuses && order.allowedStatuses.length > 0 && <div className="allowed-statuses"><small>PERMITTED STATUS UPDATES</small>{order.allowedStatuses.map((status) => <button key={status} className="status-action" disabled={saving || status === order.status || isDelivered(order.status) || isCancelled(order.status)} onClick={() => void changeStatus(status)} type="button"><span>{friendly(status)}</span><ArrowRight size={15} /></button>)}</div>}
            {order.allowedStatuses?.length === 0 && <p className="muted small-copy">No further status updates are currently allowed.</p>}
            {!isDelivered(order.status) && !isCancelled(order.status) && !isAwaitingAcceptance(order.status) && <div className="location-sharing"><div className="location-sharing__heading"><MapPin size={17} /><strong>Delivery location</strong></div><p>Share genuine browser GPS updates while fulfilling this assigned order. Updates are sent after about 200 metres of movement.</p>{tracking ? <button className="button button--outline button--wide" onClick={stopSharing} type="button">Stop sharing location</button> : <button className="button button--dark button--wide" onClick={startSharing} type="button">Start location sharing</button>}</div>}
            {isDelivered(order.status) && <div className="delivered-note"><PackageCheck size={19} /><span>This order is marked delivered by Buddyyaa.</span></div>}
          </aside>
        </div>
      </>}
    </section>
  </main>
}
