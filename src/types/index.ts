/** Client-side types mirroring the NearBuy API responses (camelCase). */

export type Role = 'customer' | 'seller' | 'rider';

export interface User {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  vehicleType?: string | null;
  vehicleNumber?: string | null;
  licenseNumber?: string | null;
  onboardingCompleted?: boolean;
  createdAt?: string;
  profileImage?: string | null;
}

export interface AppConfig {
  appName: string;
  version: string;
  demoMode: boolean;
  deliveryFeePerStore: number;
  freeDeliveryThreshold: number;
  demoAccounts: { role: Role; name: string; email: string; password: string }[];
}

export interface Store {
  id: string;
  seller_id: string;
  seller_name?: string;
  name: string;
  description: string | null;
  category: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  opening_hours: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  operating_days?: string | null;
  contact_phone?: string | null;
  status: 'open' | 'closed' | 'inactive';
  image: string | null;
  logo?: string | null;
  contact_email?: string | null;
  is_published?: number;
  temporarily_unavailable?: number;
  supports_delivery?: number;
  supports_pickup?: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  product_count?: number;
  distanceKm?: number | null;
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  category: string;
  image: string | null;
  price: number;
  /** Sellable stock = stock_quantity - reserved_quantity. */
  stock: number;
  stock_quantity?: number;
  reserved_quantity?: number;
  low_stock_threshold?: number;
  sellable?: number;
  is_published: number;
  brand?: string | null;
  unit?: string | null;
  sku?: string | null;
  mrp?: number | null;
  availability?: 'available' | 'unavailable' | 'temporary';
  additional_images?: string[];
  inventory_version?: number;
  store_name?: string;
  store_status?: string;
  store_city?: string;
  supports_delivery?: number;
  supports_pickup?: number;
  opening_hours?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  category: string;
  image: string | null;
  quantity: number;
  stock: number;
  store_id: string;
  store_name: string;
  store_status: string;
  supports_delivery: number;
  supports_pickup: number;
  lineTotal: number;
  issue: string | null;
}

export interface CartStoreGroup {
  storeId: string;
  storeName: string;
  storeStatus: string;
  supportsDelivery: boolean;
  supportsPickup: boolean;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
}

export interface CartResponse {
  cart: { id: string };
  items: CartItem[];
  stores: CartStoreGroup[];
  subtotal: number;
}

export interface CustomerAddress {
  id: string;
  customer_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address_line: string;
  city: string;
  state: string;
  pincode: string;
  is_default: number;
  created_at?: string;
}

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'packed'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  image: string | null;
}

export interface OrderTimelineEvent {
  event_type: string;
  actor_role: string;
  note: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentType: 'delivery' | 'pickup';
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
  address: Record<string, string | null>;
  acceptedAt?: string | null;
  readyAt?: string | null;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  cancelledReason?: string | null;
  items: OrderItem[];
  timeline: OrderTimelineEvent[];
  store?: { id: string; name: string; address: string; city: string; phone?: string | null; openingHours?: string | null };
  /** Customer-only secret; never returned to sellers/riders. */
  deliveryCode?: string | null;
  /** Seller-only secret, revealed once the order is packed/ready. */
  pickupCode?: string | null;
  customer?: { name: string; phone: string | null } | null;
  rider?: { name: string; phone: string | null; status?: string } | null;
  jobStatus?: string | null;
  riderVerified?: boolean;
}

export interface DeliveryJob {
  jobId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  jobStatus: string;
  earnings: number;
  orderTotal: number;
  itemCount: number;
  createdAt: string;
  claimedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  store: { id: string; name: string; address: string; city: string; phone?: string | null; openingHours?: string | null };
  dropCity: string | null;
  dropPincode: string | null;
  drop: { address?: string; city?: string; pincode?: string; name?: string } | null;
  customerPhone: string | null;
  order?: Order;
}

export interface StockRequest {
  id: string;
  product_id: string;
  product_name: string;
  product_image?: string | null;
  product_price?: number;
  store_id: string;
  store_name?: string;
  customer_name?: string;
  customer_phone?: string | null;
  requested_quantity: number;
  status: 'pending' | 'confirmed' | 'unavailable';
  seller_response: string | null;
  note?: string | null;
  stock_quantity?: number;
  sellable?: number;
  created_at: string;
  responded_at?: string | null;
}

export interface Reservation {
  id: string;
  product_id: string;
  product_name: string;
  product_image?: string | null;
  product_price?: number;
  store_id: string;
  store_name?: string;
  customer_name?: string;
  customer_phone?: string | null;
  requested_quantity: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'fulfilled' | 'expired';
  seller_response: string | null;
  note?: string | null;
  holds_stock: number;
  requested_at: string;
  responded_at?: string | null;
  expires_at?: string | null;
  sellable?: number;
  stock_quantity?: number;
  created_at: string;
}

export interface CheckoutQuote {
  quote: {
    fulfilmentType: 'delivery' | 'pickup';
    subtotal: number;
    deliveryFee: number;
    total: number;
    stores: {
      storeId: string;
      storeName: string;
      subtotal: number;
      deliveryFee: number;
      total: number;
      itemCount: number;
    }[];
  };
  issues: string[];
}
