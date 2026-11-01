import { ArrowLeft, ArrowRight, Check, Clock3, MapPin, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { EmptyState, LocationDialog } from '../components/StorefrontParts'
import { ApiError, api, formatApiError, formatSlotDay } from '../services/api'
import { useAuth, useCart, useDeliveryLocation } from '../state/AppState'
import type { DeliveryLocation, DeliverySlot, DeliveryTiming } from '../types'

interface CheckoutAttempt {
  signature: string
  key: string
}

function idempotencyKey(signature: string) {
  const storageKey = 'buddyyaa-checkout-attempt'
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as CheckoutAttempt | null
    if (stored?.signature === signature && stored.key) return stored.key
    const key = crypto.randomUUID()
    sessionStorage.setItem(storageKey, JSON.stringify({ signature, key } satisfies CheckoutAttempt))
    return key
  } catch {
    return crypto.randomUUID()
  }
}

export function Checkout() {
  const { user, role, loading } = useAuth()
  const cart = useCart()
  const { refreshProducts } = cart
  const { location, setLocation } = useDeliveryLocation()
  const navigate = useNavigate()
  const [address, setAddress] = useState<string | null>(null)
  const [locationOpen, setLocationOpen] = useState(false)
  const [error, setError] = useState('')
  const [inventoryError, setInventoryError] = useState('')
  const [checkingInventory, setCheckingInventory] = useState(false)
  const [inventoryRefreshKey, setInventoryRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [timing, setTiming] = useState<DeliveryTiming>('NOW')
  const [slots, setSlots] = useState<DeliverySlot[]>([])
  const [slotId, setSlotId] = useState('')
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0)
  const sending = useRef(false)
  const mode = cart.state.mode
  const lines = mode === 'ufd' ? cart.state.ufd : cart.state.normal
  const linesRef = useRef(lines)
  const ufdBuddyId = cart.state.ufdBuddyId
  const locationLatitude = location?.latitude
  const locationLongitude = location?.longitude
  const deliveryAddress = address ?? location?.address ?? user?.address ?? ''
  const subtotalEstimate = useMemo(() => lines.reduce((sum, line) => sum + (line.product.salePrice ?? line.product.price) * line.quantity, 0), [lines])
  const basketSignature = lines.map((line) => `${line.product.id}:${line.quantity}`).join('|')

  useEffect(() => {
    linesRef.current = lines
  }, [lines])

  useEffect(() => {
    if (loading || !user || role !== 'customer') return
    if (mode !== 'ufd' || !basketSignature) {
      setInventoryError('')
      setCheckingInventory(false)
      return
    }
    if (locationLatitude === undefined || locationLongitude === undefined) {
      setInventoryError('Choose a delivery location before checking UFD availability.')
      setCheckingInventory(false)
      return
    }
    if (!ufdBuddyId) {
      setInventoryError('This UFD basket has no selected Buddy. Return to UFD and refresh its catalogue.')
      setCheckingInventory(false)
      return
    }
    let active = true
    setCheckingInventory(true)
    setInventoryError('')
    const currentLines = linesRef.current
    void api.ufdCatalogue({ latitude: locationLatitude, longitude: locationLongitude })
      .then((catalogue) => {
        if (!active) return
        if (catalogue.buddy.id !== ufdBuddyId) {
          setInventoryError('The nearest UFD Buddy has changed since this basket was created. Your basket was not switched. Return to UFD, clear it, and add products from the currently selected Buddy.')
          return
        }
        const current = new Map(catalogue.products.map((product) => [product.id, product]))
        const unavailable = currentLines.find((line) => {
          const product = current.get(line.product.id)
          return !product || (product.availableQuantity !== undefined && product.availableQuantity < line.quantity)
        })
        if (unavailable) {
          setInventoryError(`${unavailable.product.name} is no longer available in the quantity selected. Edit your basket or refresh UFD and try again.`)
          return
        }
        refreshProducts(catalogue.products, 'ufd')
      })
      .catch((reason: unknown) => {
        if (active) setInventoryError(`We couldn’t verify this Buddy’s current stock. ${formatApiError(reason)}`)
      })
      .finally(() => { if (active) setCheckingInventory(false) })
    return () => { active = false }
  }, [basketSignature, inventoryRefreshKey, locationLatitude, locationLongitude, loading, mode, refreshProducts, role, ufdBuddyId, user])

  useEffect(() => {
    if (loading || !user || role !== 'customer') return
    if (mode !== 'normal' || !basketSignature) return
    let active = true
    setCheckingInventory(true)
    setInventoryError('')
    const currentLines = linesRef.current
    void api.products()
      .then((products) => {
        if (!active) return
        const available = new Set(products.map((product) => product.id))
        const missing = currentLines.find((line) => !available.has(line.product.id))
        if (missing) {
          setInventoryError(`${missing.product.name} is no longer in the active catalogue. Remove it or return to shopping before checkout.`)
          return
        }
        refreshProducts(products, 'normal')
      })
      .catch((reason: unknown) => {
        if (active) setInventoryError(`We couldn’t refresh current catalogue prices. ${formatApiError(reason)}`)
      })
      .finally(() => { if (active) setCheckingInventory(false) })
    return () => { active = false }
  }, [basketSignature, inventoryRefreshKey, loading, mode, refreshProducts, role, user])

  useEffect(() => {
    if (timing !== 'SCHEDULED') return
    let active = true
    setSlotsLoading(true)
    setSlotsError('')
    void api.deliverySlots()
      .then((next) => {
        if (!active) return
        setSlots(next)
        setSlotId((current) => next.some((slot) => slot.id === current) ? current : '')
        if (!next.length) setSlotsError('No delivery slots are open right now. Choose “As soon as possible” or try again later.')
      })
      .catch((reason: unknown) => { if (active) setSlotsError(`We couldn’t load delivery slots. ${formatApiError(reason)}`) })
      .finally(() => { if (active) setSlotsLoading(false) })
    return () => { active = false }
  }, [slotsRefreshKey, timing])

  if (loading) return <div className="page-loading" role="status">Restoring your account…</div>
  if (role === 'buddy') return <Navigate to="/buddy" replace />
  if (!lines.length) return <section className="page-wrap shell"><EmptyState icon={<ShoppingBasket size={25} />} title="Your basket is taking a breather" message="Add some fresh finds before heading to checkout." action={<Link className="button button--gold" to="/">Explore the catalogue <ArrowRight size={16} /></Link>} /></section>
  if (!user || role !== 'customer') return <Navigate to="/login" replace />

  function applyLocation(next: DeliveryLocation) {
    setLocation(next)
    setAddress(next.address)
    setLocationOpen(false)
  }

  async function placeOrder(event: FormEvent) {
    event.preventDefault()
    if (sending.current) return
    if (!deliveryAddress.trim()) {
      setError('Add a delivery address before placing your order.')
      return
    }
    if (!location) {
      setError('Choose a delivery location so Buddyyaa can check which Buddy can fulfill your basket.')
      setLocationOpen(true)
      return
    }
    if (mode === 'ufd' && !cart.state.ufdBuddyId) {
      setError('Refresh UFD availability before placing this order so the selected Buddy is confirmed.')
      return
    }
    if (mode === 'ufd' && (checkingInventory || inventoryError)) {
      setError(inventoryError || 'Please wait while we check the selected Buddy’s current stock.')
      return
    }
    if (timing === 'SCHEDULED' && !slotId) {
      setError('Choose a delivery slot, or switch to “As soon as possible”.')
      return
    }
    sending.current = true
    setBusy(true)
    setError('')
    const signature = JSON.stringify({
      mode,
      items: lines.map((line) => [line.product.id, line.quantity]),
      address: deliveryAddress.trim(),
      buddyId: mode === 'ufd' ? cart.state.ufdBuddyId : undefined,
      location: location ? [location.latitude, location.longitude] : undefined,
      slot: timing === 'SCHEDULED' ? slotId : undefined,
    })
    try {
      const order = await api.createOrder({
        deliveryType: mode === 'ufd' ? 'UFD' : 'NORMAL',
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        deliveryLocation: { latitude: location.latitude, longitude: location.longitude, address: deliveryAddress.trim() },
        ...(mode === 'ufd' && cart.state.ufdBuddyId ? { selectedBuddyId: cart.state.ufdBuddyId } : {}),
        ...(timing === 'SCHEDULED' ? { deliveryMode: 'SCHEDULED' as const, scheduledSlotId: slotId } : {}),
        idempotencyKey: idempotencyKey(signature),
      })
      sessionStorage.removeItem('buddyyaa-checkout-attempt')
      cart.clear(mode)
      navigate(`/orders/${encodeURIComponent(order.id)}`, { replace: true, state: { created: true } })
    } catch (reason) {
      const errorMessage = reason instanceof ApiError && [409, 422].includes(reason.status)
        ? 'Stock or delivery availability changed before checkout. Review your basket and try again.'
        : formatApiError(reason)
      setError(errorMessage)
      if (timing === 'SCHEDULED' && reason instanceof ApiError && reason.status === 400) setSlotsRefreshKey((value) => value + 1)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <main className="page-wrap shell checkout-page">
      <Link to="/" className="back-link"><ArrowLeft size={16} /> Back to shopping</Link>
      <div className="checkout-heading"><span className="eyebrow">ONE NEIGHBORHOOD BASKET</span><h1>Review your basket<span className="title-period">.</span></h1><p>Buddyyaa checks current inventory and confirms your order with the server before it’s placed.</p></div>
      <div className="checkout-layout">
        <section className="checkout-items">
          <div className="checkout-card-heading"><div><ShoppingBasket size={18} /><h2>Your items</h2></div><span>{lines.reduce((sum, line) => sum + line.quantity, 0)} items</span></div>
          {lines.map(({ product, quantity }) => <article className="checkout-line" key={product.id}>
            <div className="checkout-line__image">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span aria-hidden="true">🥬</span>}</div>
            <div className="checkout-line__details"><strong>{product.name}</strong><span>{product.unit || 'As listed'} · ₹{(product.salePrice ?? product.price).toFixed(2)} each</span><small>Line estimate ₹{((product.salePrice ?? product.price) * quantity).toFixed(2)}</small></div>
            <div className="quantity-control"><button aria-label={`Remove one ${product.name}`} onClick={() => cart.setQuantity(product.id, quantity - 1)} type="button"><Minus size={14} /></button><span>{quantity}</span><button aria-label={`Add one ${product.name}`} disabled={product.availableQuantity !== undefined && quantity >= product.availableQuantity} onClick={() => cart.setQuantity(product.id, quantity + 1)} type="button"><Plus size={14} /></button></div>
            <button className="remove-line" aria-label={`Remove ${product.name}`} onClick={() => cart.remove(product.id)} type="button"><Trash2 size={16} /></button>
          </article>)}
          <div className="basket-note"><Check size={16} /><span>Prices and stock are revalidated by Buddyyaa when you place the order. The server’s confirmed total is authoritative.</span></div>
          <div className="delivery-mode-card"><span className={`delivery-mode-card__icon ${mode === 'ufd' ? 'is-gold' : ''}`}><MapPin size={18} /></span><div><small>DELIVERY MODE</small><strong>{mode === 'ufd' ? 'UFD · Ultra Fast Delivery' : 'Normal delivery'}</strong><span>{mode === 'ufd' ? 'All products will be fulfilled by the same selected Buddy.' : 'The backend selects one Buddy able to fulfill your complete basket.'}</span></div><Link to="/" className="text-link">Change</Link></div>
          <div className={inventoryError ? 'ufd-stock-check ufd-stock-check--error' : 'ufd-stock-check'} role={inventoryError ? 'alert' : 'status'}>{checkingInventory ? mode === 'ufd' ? 'Checking current stock with your selected Buddy…' : 'Refreshing active catalogue prices…' : inventoryError || (mode === 'ufd' ? `Stock checked for ${cart.state.ufdBuddyName ?? 'your selected Buddy'}.` : 'Active catalogue prices refreshed.')}{inventoryError && <button className="text-link" type="button" onClick={() => setInventoryRefreshKey((value) => value + 1)}>Check again</button>}</div>
        </section>

        <aside className="checkout-summary">
          <span className="eyebrow">ALMOST THERE</span><h2>Delivery details</h2>
          <div className="checkout-address">
            <div className="checkout-address__top"><MapPin size={17} /><strong>Deliver to</strong><button className="text-link" onClick={() => setLocationOpen(true)} type="button">Edit</button></div>
            <p>{deliveryAddress || 'No address selected yet'}</p>
            {location ? <small>Delivery coordinates are sent securely to Buddyyaa for fulfillment selection.</small> : <small>Choose a delivery location before placing your order.</small>}
          </div>
          <form onSubmit={(event) => void placeOrder(event)}>
            <fieldset className="delivery-timing"><legend><Clock3 size={16} /> Delivery time</legend>
              <label className="delivery-timing__option"><input type="radio" name="delivery-timing" checked={timing === 'NOW'} onChange={() => setTiming('NOW')} /> As soon as possible</label>
              <label className="delivery-timing__option"><input type="radio" name="delivery-timing" checked={timing === 'SCHEDULED'} onChange={() => setTiming('SCHEDULED')} /> Schedule for later</label>
              {timing === 'SCHEDULED' && (slotsError ? <p className="form-error" role="alert">{slotsError}</p> : <label className="form-label">Delivery slot<select disabled={slotsLoading} onChange={(event) => setSlotId(event.target.value)} value={slotId}><option value="">{slotsLoading ? 'Loading slots…' : 'Choose a slot'}</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{formatSlotDay(slot.start)} · {slot.label}</option>)}</select></label>)}
            </fieldset>
            <label className="form-label">Delivery address<textarea onChange={(event) => setAddress(event.target.value)} placeholder="House number, street, neighborhood" rows={3} value={deliveryAddress} /></label>
            {error && <p className="form-error form-error--box" role="alert">{error}</p>}
            <div className="summary-totals"><div><span>Items subtotal (estimate)</span><strong>₹{subtotalEstimate.toFixed(2)}</strong></div><small>Buddyyaa validates stock, delivery charges and the final total when you place the order.</small><div className="summary-estimate"><span>Final order total</span><strong>Confirmed by Buddyyaa</strong></div></div>
            <button className="button button--gold button--wide checkout-submit" disabled={busy || checkingInventory || Boolean(inventoryError) || !deliveryAddress.trim() || !location || (timing === 'SCHEDULED' && !slotId)} type="submit">{busy ? 'Confirming with Buddyyaa…' : checkingInventory ? 'Checking Buddy stock…' : 'Place order'} <ArrowRight size={17} /></button>
          </form>
          <p className="checkout-trust">No payment is collected by this page. You’ll see the genuine order confirmation returned by Buddyyaa.</p>
        </aside>
      </div>
      {locationOpen && <LocationDialog onClose={() => setLocationOpen(false)} onSave={applyLocation} />}
    </main>
  )
}
