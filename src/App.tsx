import React from 'react';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth, roleHome } from './context/AuthContext';
import { CartProvider, useCart } from './context/CartContext';
import { AppShell } from './components/layout/AppShell';
import { SellerShell } from './components/layout/SellerShell';
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
  SellerStorePreviewPage, SellerBusinessPage, SellerEarningsPage,
  SellerStockRequestsPage, SellerReservationsPage, SellerNotificationsPage, SellerSupportPage,
  SellerProfilePage, SellerSettingsPage, SellerSecurityPage,
} from './pages/seller';
import {
  RiderActivePage,
  RiderDashboardPage,
  RiderEarningsPage,
  RiderHistoryPage,
  RiderJobDetailPage,
  RiderJobsPage,
  RiderProfilePage,
} from './pages/rider';
import { CustomerHomePage, SavedItemsPage } from './pages/customerHome';
import { NotificationsPage, SecuritySettingsPage, SupportPage } from './pages/shared';
import type { Role } from './types';

type RouteMatch = { element: React.ReactNode; key: string } | null;

const ROLES: Role[] = ['customer', 'seller', 'rider'];

function resolveRoute(path: string): RouteMatch {
  const pathname = path.split('?')[0].replace(/\/+$/, '') || '/';

  // First-visit authentication gateway: the first screen for every visitor.
  if (pathname === '/') return { key: '/', element: <AuthGatewayPage /> };
  // Catalogue pages belong to the signed-in customer workspace (the API requires a customer session).
  const gated = (key: string, element: React.ReactNode): RouteMatch => ({
    key,
    element: <RequireRole role="customer">{element}</RequireRole>,
  });
  if (pathname === '/discover') return gated('discover', <DiscoverPage tab="products" />);
  if (pathname === '/discover/stores') return gated('discover-stores', <DiscoverPage tab="stores" />);

  const storeMatch = matchPath('/stores/:id', pathname);
  if (storeMatch) return gated(`store-${storeMatch.id}`, <StoreDetailPage storeId={storeMatch.id} />);

  const productMatch = matchPath('/products/:id', pathname);
  if (productMatch) return gated(`product-${productMatch.id}`, <ProductDetailPage productId={productMatch.id} />);

  // Shared account pages for every role.
  const accountMatch = matchPath('/:role/:page', pathname);
  if (accountMatch && accountMatch.role !== 'seller' && ROLES.includes(accountMatch.role as Role)) {
    const role = accountMatch.role as Role;
    const pages: Record<string, React.ReactNode> = {
      notifications: <NotificationsPage role={role} />,
      support: <SupportPage role={role} />,
      security: <SecuritySettingsPage role={role} />,
    };
    if (pages[accountMatch.page]) {
      return { key: `${role}-${accountMatch.page}`, element: <RequireRole role={role}>{pages[accountMatch.page]}</RequireRole> };
    }
  }
  if (pathname === '/customer/saved') return gated('customer-saved', <SavedItemsPage />);

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
  if (pathname === '/customer') return gated('customer-home', <CustomerHomePage />);
  if (pathname === '/customer/discover') {
    navigate('/discover', { replace: true });
    return { key: 'redirect-discover', element: null };
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
  const sellerPages: Record<string, React.ReactNode> = {
    '/seller': <SellerDashboardPage />,
    '/seller/dashboard': <SellerDashboardPage />,
    '/seller/orders': <SellerOrdersPage />,
    '/seller/products': <SellerProductsPage />,
    '/seller/products/new': <ProductEditorPage />,
    '/seller/inventory': <SellerInventoryPage />,
    '/seller/requests': <SellerStockRequestsPage />,
    '/seller/stock-requests': <SellerStockRequestsPage />,
    '/seller/reservations': <SellerReservationsPage />,
    '/seller/store': <SellerStorePage />,
    '/seller/store/hours': <SellerStorePage section="hours" />,
    '/seller/store/location': <SellerStorePage section="location" />,
    '/seller/store/preview': <SellerStorePreviewPage />,
    '/seller/business': <SellerBusinessPage />,
    '/seller/performance': <SellerPerformancePage />,
    '/seller/analytics': <SellerPerformancePage />,
    '/seller/earnings': <SellerEarningsPage />,
    '/seller/notifications': <SellerNotificationsPage />,
    '/seller/support': <SellerSupportPage />,
    '/seller/profile': <SellerProfilePage />,
    '/seller/settings': <SellerSettingsPage />,
    '/seller/settings/security': <SellerSecurityPage />,
    '/seller/security': <SellerSecurityPage />,
  };
  if (sellerPages[pathname]) return { key: pathname.startsWith('/seller/store') && pathname !== '/seller/store/preview' ? 'seller-store' : pathname, element: <RequireRole role="seller">{sellerPages[pathname]}</RequireRole> };
  const sellerOrderMatch = matchPath('/seller/orders/:id', pathname);
  if (sellerOrderMatch) return { key: `seller-order-${sellerOrderMatch.id}`, element: <RequireRole role="seller"><SellerOrderDetailPage orderId={sellerOrderMatch.id} /></RequireRole> };
  const sellerProductMatch = matchPath('/seller/products/:id', pathname);
  if (sellerProductMatch) return { key: `seller-product-${sellerProductMatch.id}`, element: <RequireRole role="seller"><ProductEditorPage productId={sellerProductMatch.id} /></RequireRole> };

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
  if (pathname === '/rider/active') {
    return {
      key: 'rider-active',
      element: (
        <RequireRole role="rider">
          <RiderActivePage />
        </RequireRole>
      ),
    };
  }
  if (pathname === '/rider/earnings') {
    return {
      key: 'rider-earnings',
      element: (
        <RequireRole role="rider">
          <RiderEarningsPage />
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
  const { itemCount } = useCart();
  const route = resolveRoute(path);

  // Workspace home shortcuts for signed-in users hitting the landing page.
  React.useEffect(() => {
    if (user && (path === '/' || /^\/(customer|seller|rider)\/(auth|signup|recover)(\?|$)/.test(path))) {
      const home = roleHome(user.role);
      navigate(home, { replace: true });
    }
  }, [path, user]);

  const content = <React.Fragment key={route?.key}>{route ? route.element : <NotFoundPage />}</React.Fragment>;
  if (path === '/' || /^\/(customer|seller|rider)\/(auth|login|signup|recover)(\?|$)/.test(path)) return content;
  if (user?.role === 'seller' && (path === '/seller' || path.startsWith('/seller/')) && !/\/(auth|signup|recover)(\?|$)/.test(path)) return <SellerShell>{content}</SellerShell>;
  return <AppShell cartCount={itemCount}>{content}</AppShell>;
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
