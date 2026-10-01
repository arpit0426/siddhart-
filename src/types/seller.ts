import type { OrderStatus, Store } from './index';

export interface Pagination { page: number; pageSize: number; total: number; pages: number }
export interface OrderSummary {
  id: string; orderNumber: string; status: OrderStatus; fulfillmentType: 'delivery' | 'pickup';
  subtotal: number; deliveryFee: number; total: number; createdAt: string; itemCount: number; customer: { name: string };
}
export interface DailySales { day: string; orders: number; revenue: number }
export interface SellerNotification { id: string; category: string; title: string; body: string; href: string; read_at: string | null; created_at: string }
export interface SellerDashboard {
  store: Store | null;
  metrics: {
    totalOrders: number; revenue: number; subtotalRevenue: number; delivered: number; todayRevenue: number;
    todayOrders: number; pendingOrders: number; heldUnits: number; lowStockCount: number; totalProducts: number; healthy: number; outOfStock: number;
  } | null;
  actionRequired: { newOrders: number; pendingStockRequests: number; pendingReservations: number; packedAwaitingPickup: number; readyForPickup: number; inProgress: number } | null;
  orderCounts: Partial<Record<OrderStatus, number>>;
  recentOrders: OrderSummary[]; liveOrders: OrderSummary[];
  lowStock: { id: string; name: string; image: string | null; stock_quantity: number; reserved_quantity: number; sellable: number; low_stock_threshold: number }[];
  daily: DailySales[]; activity: SellerNotification[]; unreadNotifications: number;
  setup: { percent: number; checks: { label: string; done: boolean }[] };
}
export interface SellerAnalytics {
  totals: { orders: number; delivered: number; cancelled: number; rejected: number; subtotal: number; averageOrderValue: number; averagePreparationMinutes: number | null } | null;
  topProducts: { name: string; image: string | null; units: number; revenue: number }[];
  daily: DailySales[]; categories: { name: string; units: number; revenue: number }[];
  periods: { today: number; week: number; month: number }; inventory: { low: number; out: number };
}
