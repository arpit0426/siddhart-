export type Role = 'customer' | 'seller' | 'rider';

export interface User {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
  status: string;
}

export interface Store {
  id: string;
  seller_id: string;
  name: string;
  description: string;
  category: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  opening_hours: string;
  status: 'open' | 'closed' | 'inactive';
  image: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  description: string;
  category: string;
  image: string | null;
  price: number;
  stock: number;
  is_published: number;
  created_at: string;
  updated_at: string;
  store_name?: string;
  store_status?: string;
  store_city?: string;
}

export interface CartItem {
  id: string;
  product_id: string;
  quantity: number;
  name: string;
  price: number;
  stock: number;
  image: string | null;
  category: string;
  store_id: string;
  store_name: string;
  store_status: string;
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
  order_id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  product_image: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id?: string;
  store_id?: string;
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
  subtotal: number;
  delivery_fee: number;
  total: number;
  payment_method: string;
  address_snapshot?: any;
  pickup_code?: string | null; // Only available to seller at ready_for_pickup stage
  delivery_code?: string | null; // Only available to customer
  customer_name?: string;
  customer_phone?: string;
  store_name?: string;
  store_address?: string;
  store_city?: string;
  store_phone?: string;
  rider_name?: string;
  rider_phone?: string;
  delivery_status?: string;
  items?: OrderItem[];
  created_at: string;
  updated_at: string;
}

export interface DeliveryJob {
  id: string;
  order_id: string;
  rider_id?: string | null;
  status: 'available' | 'claimed' | 'pickup_verified' | 'out_for_delivery' | 'completed' | 'cancelled';
  earnings: number;
  order_number: string;
  order_status: OrderStatus;
  order_total: number;
  address_snapshot: any;
  store_name: string;
  store_address: string;
  store_city: string;
  store_phone?: string;
  customer_name?: string;
  customer_phone?: string;
  items?: OrderItem[];
  claimed_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface StockRequest {
  id: string;
  customer_id: string;
  store_id: string;
  product_id: string;
  product_name?: string;
  product_image?: string | null;
  store_name?: string;
  customer_name?: string;
  requested_quantity: number;
  status: 'pending' | 'confirmed' | 'unavailable';
  seller_response?: string | null;
  created_at: string;
}

export interface Reservation {
  id: string;
  customer_id: string;
  store_id: string;
  product_id: string;
  product_name?: string;
  product_price?: number;
  product_image?: string | null;
  store_name?: string;
  customer_name?: string;
  requested_quantity: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'fulfilled' | 'cancelled';
  seller_response?: string | null;
  created_at: string;
}
