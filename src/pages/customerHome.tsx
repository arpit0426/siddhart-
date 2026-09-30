import React, { useMemo, useState } from 'react';
import { ArrowRight, Heart, PackageSearch, Search, Truck } from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { useApiResource } from '../lib/hooks';
import { formatINR, orderStatusMeta } from '../lib/format';
import { locationParams, useBrowseLocation } from '../lib/location';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import type { Order, Product, Store } from '../types';
import { Badge, Card, EmptyState, ErrorNote, SectionHeader, Skeleton } from '../components/ui';
import { ProductCard, StoreCard } from './public';

interface Dashboard {
  stores: Store[];
  categories: { category: string; slug: string; count: number }[];
  popularProducts: Product[];
  popularBasis: 'orders' | 'recent';
  activeOrder: Order | null;
  activeOrderCount: number;
  defaultAddress: { id: string; label: string; address_line: string } | null;
}

/** Customer home: everything here comes from /api/customer/dashboard (live data). */
export const CustomerHomePage: React.FC = () => {
  const location = useBrowseLocation();
  const geo = locationParams(location);
  const { cart, updateItem } = useCart();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);

  const resource = useApiResource(
    () => api.get<Dashboard>(`/api/customer/dashboard?${new URLSearchParams(geo).toString()}`),
    [geo.lat, geo.lng],
    { pollMs: 30000 }
  );

  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    (cart?.items ?? []).forEach((item) => map.set(item.product_id, item.quantity));
    return map;
  }, [cart]);

  const add = async (product: Product) => {
    setAddingId(product.id);
    try {
      await updateItem(product.id, (quantities.get(product.id) ?? 0) + 1);
      toast.push({ title: `Added ${product.name}`, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not add item', description: errorMessage(error), tone: 'error' });
    } finally {
      setAddingId(null);
    }
  };

  const data = resource.data;

  return (
    <div className="space-y-7">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(`/discover${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
        }}
        className="relative"
      >
        <label htmlFor="home-search" className="sr-only">
          Search products and stores
        </label>
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
        <input
          id="home-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search milk, atta, medicines, stores…"
          className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3 text-sm shadow-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
        />
      </form>

      {resource.error && <ErrorNote>{resource.error}</ErrorNote>}

      {data?.activeOrder && (
        <Link
          to={`/orders/${data.activeOrder.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100/70"
        >
          <span className="flex items-center gap-3">
            <Truck className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <span>
              <span className="block text-sm font-bold text-slate-900">
                Order #{data.activeOrder.orderNumber} · {orderStatusMeta(data.activeOrder.status).label}
              </span>
              <span className="block text-xs text-slate-600">
                {data.activeOrder.store?.name}
                {data.activeOrderCount > 1 ? ` · ${data.activeOrderCount} active orders` : ''}
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 text-blue-700" aria-hidden="true" />
        </Link>
      )}

      <section aria-labelledby="home-categories">
        <SectionHeader title="Shop by category" as="h2" />
        <h2 id="home-categories" className="sr-only">
          Categories
        </h2>
        {!data ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {data.categories.map((category) => (
              <li key={category.slug}>
                <Link
                  to={`/discover?category=${encodeURIComponent(category.category)}`}
                  className="flex min-h-[56px] items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 hover:border-blue-300 hover:bg-blue-50"
                >
                  <span>{category.category}</span>
                  <Badge tone={category.count ? 'info' : 'neutral'}>{category.count}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader
          title={location ? `Stores near ${location.label}` : 'Stores nearby'}
          subtitle={!location ? 'Choose an area in the header to sort by distance.' : undefined}
          action={
            <Link to="/discover/stores" className="text-xs font-semibold text-blue-700 hover:underline">
              See all
            </Link>
          }
        />
        {!data ? (
          <Skeleton className="h-40" />
        ) : data.stores.length === 0 ? (
          <EmptyState title="No stores in this area yet" icon={<PackageSearch className="h-8 w-8" aria-hidden="true" />} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.stores.slice(0, 6).map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title={data?.popularBasis === 'orders' ? 'Popular this month' : 'New on NearBuy'}
          subtitle={
            data?.popularBasis === 'orders'
              ? 'Ranked by real orders from the last 30 days.'
              : 'Recently added by nearby stores.'
          }
        />
        {!data ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.popularProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                quantityInCart={quantities.get(product.id) ?? 0}
                adding={addingId === product.id}
                onAdd={() => add(product)}
              />
            ))}
          </div>
        )}
      </section>

      <Card className="flex items-center justify-between gap-3 p-4">
        <span className="flex items-center gap-2 text-sm text-slate-700">
          <Heart className="h-4 w-4 text-red-500" aria-hidden="true" /> Your saved items, always at current price and stock.
        </span>
        <Link to="/customer/saved" className="text-xs font-semibold text-blue-700 hover:underline">
          View saved
        </Link>
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Saved items                                                                */
/* -------------------------------------------------------------------------- */

export const SavedItemsPage: React.FC = () => {
  const toast = useToast();
  const { cart, updateItem } = useCart();
  const [addingId, setAddingId] = useState<string | null>(null);
  const resource = useApiResource(() => api.get<{ items: Product[] }>('/api/customer/saved'), []);

  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    (cart?.items ?? []).forEach((item) => map.set(item.product_id, item.quantity));
    return map;
  }, [cart]);

  const add = async (product: Product) => {
    setAddingId(product.id);
    try {
      await updateItem(product.id, (quantities.get(product.id) ?? 0) + 1);
      toast.push({ title: `Added ${product.name}`, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not add item', description: errorMessage(error), tone: 'error' });
    } finally {
      setAddingId(null);
    }
  };

  const items = resource.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader as="h1" title="Saved items" subtitle="Prices and availability are always checked live." />
      {resource.error && <ErrorNote>{resource.error}</ErrorNote>}
      {resource.loading && !resource.data && <Skeleton className="h-48" />}
      {resource.data && items.length === 0 && (
        <EmptyState
          icon={<Heart className="h-8 w-8" aria-hidden="true" />}
          title="Nothing saved yet"
          description="Tap the heart on any product to keep it here."
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            quantityInCart={quantities.get(product.id) ?? 0}
            adding={addingId === product.id}
            onAdd={() => add(product)}
          />
        ))}
      </div>
    </div>
  );
};
