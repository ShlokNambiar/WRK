// Billing via RevenueCat (Google Play subscriptions). This is a thin, web-safe
// wrapper: the native plugin is lazy-imported only on a real device, so the web
// build and the SSR harness never load native code. Everything no-ops gracefully
// until the RevenueCat public key + Play product are configured (see HANDOFF) —
// so the UI can call these today without crashing.
//
// The RevenueCat "app user id" is set to the Supabase user id, so the rc-webhook
// can map purchases back to the right account.

// Public RevenueCat SDK key (safe to embed). Empty until set at handoff.
const RC_PUBLIC_KEY = '' // e.g. 'goog_xxx' — set during handoff
const PRO_ENTITLEMENT = 'pro'

function isNative() {
  if (typeof window === 'undefined') return false
  const cap = window.Capacitor
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
}

async function plugin() {
  if (!isNative() || !RC_PUBLIC_KEY) return null
  try {
    const mod = await import('@revenuecat/purchases-capacitor')
    return mod.Purchases || null
  } catch {
    return null
  }
}

let configured = false

// Call once after the user is known. No-op on web / before keys exist.
export async function initBilling(userId) {
  const Purchases = await plugin()
  if (!Purchases || configured) return
  try {
    await Purchases.configure({ apiKey: RC_PUBLIC_KEY, appUserID: userId || undefined })
    configured = true
  } catch {
    /* not fatal — billing simply stays unavailable */
  }
}

// Returns true if the live RevenueCat customer info shows the Pro entitlement.
// (The server `entitlements` table is the source of truth via the webhook; this
// is just for immediate post-purchase UI feedback.)
export async function isProActive() {
  const Purchases = await plugin()
  if (!Purchases) return false
  try {
    const { customerInfo } = await Purchases.getCustomerInfo()
    return !!customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT]
  } catch {
    return false
  }
}

// Launch the purchase flow. Returns 'unavailable' on web/unconfigured so the UI
// can show a friendly message instead of failing.
export async function purchasePro() {
  const Purchases = await plugin()
  if (!Purchases) return { status: 'unavailable' }
  try {
    const offerings = await Purchases.getOfferings()
    const pkg = offerings?.current?.availablePackages?.[0]
    if (!pkg) return { status: 'no_offering' }
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg })
    const active = !!customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT]
    return { status: active ? 'pro' : 'pending' }
  } catch (e) {
    if (e && e.userCancelled) return { status: 'cancelled' }
    return { status: 'error' }
  }
}

export async function restorePurchases() {
  const Purchases = await plugin()
  if (!Purchases) return { status: 'unavailable' }
  try {
    const { customerInfo } = await Purchases.restorePurchases()
    return { status: customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT] ? 'pro' : 'free' }
  } catch {
    return { status: 'error' }
  }
}
