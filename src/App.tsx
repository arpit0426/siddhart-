import React from 'react';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth, roleHome } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { AppShell } from './components/layout/AppShell';
import { RequireRole } from './components/RequireRole';
import { matchPath, navigate, useRoutePath } from './lib/router';
import {
  DiscoverPage,
  NotFoundPage,
  ProductDetailPage,
  StoreDetailPage,
} from './pages/public';
import {
  AuthGatewayPage,
  RoleAuthPage,
  RoleAuthRedirect,
  RoleRecoverPage,
  RoleSignupPage,
} from './pages/auth';
import {
  AccountPage,
  CartPage,
  CheckoutPage,
  OrderDetailPage,
  OrdersPage,
  RequestsPage,
} from './pages/customer';
import {
  ProductEditorPage,
  SellerDashboardPage,
  SellerInventoryPage,
  SellerOrderDetailPage,
  SellerOrdersPage,
  SellerPerformancePage,
  SellerProductsPage,
  SellerRequestsPage,
  SellerStorePage,
} from './pages/seller';
import {
  RiderDashboardPage,
  RiderHistoryPage,
  RiderJobDetailPage,
  RiderJobsPage,
  RiderProfilePage,
} from './pages/rider';
import type { Role } from './types';

type RouteMatch = { element: React.ReactNode; key: string } | null;

const ROLES: Role[] = ['customer', 'seller', 'rider'];

function resolveRoute(path: string): RouteMatch {
  const pathname = path.split('?')[0].replace(/\/+$/, '') || '/';

  // First-visit authentication gateway: the first screen for every visitor.
  if (pathname === '/') return { key: '/', element: <AuthGatewayPage /> };
  if (pathname === '/discover') return { key: 'discover', element: <DiscoverPage tab="products" /> };
  if (pathname === '/discover/stores') return { key: 'discover-stores', element: <DiscoverPage tab="stores" /> };

  const storeMatch = matchPath('/stores/:id', pathname);
  if (storeMatch) return { key: `store-${storeMatch.id}`, element: <StoreDetailPage storeId={storeMatch.id} /> };

  const productMatch = matchPath('/products/:id', pathname);
  if (productMatch) {
    return { key: `product-${productMatch.id}`, element: <ProductDetailPage productId={productMatch.id} /> };
  }

  const authMatch = matchPath('/:role/auth', pathname);
  if (authMatch && ROLES.includes(authMatch.role as Role)) {
    return { key: `auth-${authMatch.role}`, element: <RoleAuthPage role={authMatch.role as Role} /> };
  }

  const loginMatch = matchPath('/:role/login', pathname);
  if (loginMatch && ROLES.includes(loginMatch.role as Role)) {
    return { key: `login-${loginMatch.role}`, element: <RoleAuthRedirect role={loginMatch.role as Role} /> };
  }

  const signupMatch = matchPath('/:role/signup', pathname);
  if (signupMatch && ROLES.includes(signupMatch.role as Role)) {
    return { key: `signup-${signupMatch.role}`, element: <RoleSignupPage role={signupMatch.role as Role} /> };
  }

  const recoverMatch = matchPath('/:role/recover', pathname);
  if (recoverMatch && ROLES.includes(recoverMatch.role as Role)) {
    return { key: `recover-${recoverMatch.role}`, element: <RoleRecoverPage role={recoverMatch.role as Role} /> };
  }

  /* ----------------------------- Customer ------------------------------- */
  if (pathname === '/customer/orders') {
    return {
      key: 'customer-orders',
      element: (
        <RequireRole role="customer">
          <OrdersPage />
        </RequireRole>
      ),
    };
  }
  const customerOrderMatch = matchPath('/customer/orders/:id', pathname) ?? matchPath('/customer/order/:id', pathname);
  if (customerOrderMatch) {
    return {
      key: `customer-order-${customerOrderMatch.id}`,
      element: (
        <RequireRole role="customer">
          <OrderDetailPage orderId={customerOrderMatch.id} />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/customer/cart') navigate('/cart', { replace: true });
  if (pathname === '/customer/checkout') navigate('/checkout', { replace: true });
  if (pathname === '/customer/requests') navigate('/requests', { replace: true });
  if (pathname === '/customer/account') navigate('/account', { replace: true });
  if (pathname === '/customer' || pathname === '/customer/discover') {
    return {
      key: 'customer-home',
      element: (
        <RequireRole role="customer">
          <DiscoverPage tab="products" basePath="/customer" />
        </RequireRole>
      ),
    };
  }

  if (pathname === '/cart') {
    return {
      key: 'cart',
      element: (
        <RequireRole role="customer">
          <CartPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/checkout') {
    return {
      key: 'checkout',
      element: (
        <RequireRole role="customer">
          <CheckoutPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/orders') {
    return {
      key: 'orders',
      element: (
        <RequireRole role="customer">
          <OrdersPage />
        </RequireRole>
      ),
    };
  }
  const orderMatch = matchPath('/orders/:id', pathname);
  if (orderMatch) {
    return {
      key: `order-${orderMatch.id}`,
      element: (
        <RequireRole role="customer">
          <OrderDetailPage orderId={orderMatch.id} />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/requests') {
    return {
      key: 'requests',
      element: (
        <RequireRole role="customer">
          <RequestsPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/account') {
    return {
      key: 'account',
      element: (
        <RequireRole role="customer">
          <AccountPage />
        </RequireRole>
      ),
    };
  }

  /* ------------------------------ Seller -------------------------------- */
  if (pathname === '/seller') {
    return {
      key: 'seller',
      element: (
        <RequireRole role="seller">
          <SellerDashboardPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/orders') {
    return {
      key: 'seller-orders',
      element: (
        <RequireRole role="seller">
          <SellerOrdersPage />
        </RequireRole>
      ),
    };
  }
  const sellerOrderMatch = matchPath('/seller/orders/:id', pathname);
  if (sellerOrderMatch) {
    return {
      key: `seller-order-${sellerOrderMatch.id}`,
      element: (
        <RequireRole role="seller">
          <SellerOrderDetailPage orderId={sellerOrderMatch.id} />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/products') {
    return {
      key: 'seller-products',
      element: (
        <RequireRole role="seller">
          <SellerProductsPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/products/new') {
    return {
      key: 'seller-product-new',
      element: (
        <RequireRole role="seller">
          <ProductEditorPage />
        </RequireRole>
      ),
    };
  }
  const sellerProductMatch = matchPath('/seller/products/:id', pathname);
  if (sellerProductMatch) {
    return {
      key: `seller-product-${sellerProductMatch.id}`,
      element: (
        <RequireRole role="seller">
          <ProductEditorPage productId={sellerProductMatch.id} />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/inventory') {
    return {
      key: 'seller-inventory',
      element: (
        <RequireRole role="seller">
          <SellerInventoryPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/requests') {
    return {
      key: 'seller-requests',
      element: (
        <RequireRole role="seller">
          <SellerRequestsPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/store') {
    return {
      key: 'seller-store',
      element: (
        <RequireRole role="seller">
          <SellerStorePage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/seller/performance') {
    return {
      key: 'seller-performance',
      element: (
        <RequireRole role="seller">
          <SellerPerformancePage />
        </RequireRole>
      ),
    };
  }

  /* ------------------------------- Rider -------------------------------- */
  if (pathname === '/rider') {
    return {
      key: 'rider',
      element: (
        <RequireRole role="rider">
          <RiderDashboardPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/rider/jobs') {
    return {
      key: 'rider-jobs',
      element: (
        <RequireRole role="rider">
          <RiderJobsPage />
        </RequireRole>
      ),
    };
  }
  const riderJobMatch = matchPath('/rider/jobs/:id', pathname);
  if (riderJobMatch) {
    return {
      key: `rider-job-${riderJobMatch.id}`,
      element: (
        <RequireRole role="rider">
          <RiderJobDetailPage jobId={riderJobMatch.id} />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/rider/history') {
    return {
      key: 'rider-history',
      element: (
        <RequireRole role="rider">
          <RiderHistoryPage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/rider/profile' || pathname === '/rider/onboarding') {
    return {
      key: 'rider-profile',
      element: (
        <RequireRole role="rider">
          <RiderProfilePage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/orders/new') {
    navigate('/checkout', { replace: true });
    return { key: 'redirect-checkout', element: null };
  }

  return { key: '404', element: <NotFoundPage /> };
}

const Shell: React.FC = () => {
  const path = useRoutePath();
  const { user } = useAuth();
  const route = resolveRoute(path);

  // Workspace home shortcuts for signed-in users hitting the landing page.
  React.useEffect(() => {
    if (path === '/' && user) {
      const home = roleHome(user.role);
      if (home !== '/discover') navigate(home, { replace: true });
    }
  }, [path, user]);

  return <AppShell>{route ? route.element : <NotFoundPage />}</AppShell>;
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Shell />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
