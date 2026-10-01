import React, { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Clock,
  Heart,
  MapPin,
  PackageSearch,
  Search,
  ShoppingBag,
  Store as StoreIcon,
  Tag,
} from 'lucide-react';
import { Link, navigate, useQueryParams } from '../lib/router';
import { api, errorMessage } from '../lib/api';
import { useApiResource, useDebouncedValue } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { formatINR } from '../lib/format';
import { locationParams, useBrowseLocation } from '../lib/location';
import { useSaved } from '../lib/saved';
import type { Product, Store } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  HandoffCode,
  InfoNote,
  Modal,
  QuantityStepper,
  SectionHeader,
  SelectField,
  Skeleton,
  Spinner,
  TextAreaField,
} from '../components/ui';

/* -------------------------------------------------------------------------- */
/* Discovery                                                                  */
/* -------------------------------------------------------------------------- */

type DiscoverTab = 'products' | 'stores';

interface DiscoverProps {
  tab?: DiscoverTab;
  /** URL root this page lives at — /discover publicly, /customer in the workspace. */
  basePath?: string;
}

const CATEGORY_OPTIONS_FALLBACK = ['All categories'];

export const DiscoverPage: React.FC<DiscoverProps> = ({ tab = 'products', basePath = '/discover' }) => {
  const params = useQueryParams();
  const { user } = useAuth();
  const { cart, updateItem } = useCart();
  const toast = useToast();

  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [storeFilter, setStoreFilter] = useState(params.get('store') ?? '');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState('name');
  const [activeTab, setActiveTab] = useState<DiscoverTab>(tab);
  const [addingId, setAddingId] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const browseLocation = useBrowseLocation();
  const geo = locationParams(browseLocation);
  const geoKey = `${geo.lat ?? ''},${geo.lng ?? ''}`;

  const categoriesResource = useApiResource(
    () => api.get<{ categories: { category: string; count: number }[] }>('/api/customer/categories'),
    []
  );

  const storesResource = useApiResource(
    () =>
      api.get<{ stores: Store[] }>(
        `/api/customer/stores?${new URLSearchParams({
          ...(debouncedSearch ? { query: debouncedSearch } : {}),
          ...(category ? { category } : {}),
          ...geo,
        }).toString()}`
      ),
    [debouncedSearch, category, geoKey]
  );

  const productsResource = useApiResource(
    () =>
      api.get<{ products: Product[] }>(
        `/api/customer/products?${new URLSearchParams({
          ...(debouncedSearch ? { query: debouncedSearch } : {}),
          ...(category ? { category } : {}),
          ...(storeFilter ? { storeId: storeFilter } : {}),
          ...(maxPrice ? { maxPrice } : {}),
          ...(inStockOnly ? { inStockOnly: 'true' } : {}),
          ...geo,
          sort,
        }).toString()}`
      ),
    [debouncedSearch, category, storeFilter, maxPrice, inStockOnly, sort, geoKey]
  );

  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (debouncedSearch) query.set('q', debouncedSearch);
    if (category) query.set('category', category);
    if (storeFilter) query.set('store', storeFilter);
    const suffix = query.toString();
    const target = activeTab === 'stores' ? `${basePath}/stores` : basePath;
    const next = suffix ? `${target}?${suffix}` : target;
    if (window.location.pathname + window.location.search !== next) {
      navigate(next, { replace: true, scroll: false });
    }
  }, [debouncedSearch, category, storeFilter, activeTab]);

  const categoryOptions = useMemo(() => {
    const list = categoriesResource.data?.categories ?? [];
    return [{ value: '', label: 'All categories' }, ...list.map((row) => ({ value: row.category, label: `${row.category} (${row.count})` }))];
  }, [categoriesResource.data]);

  const cartQuantities = useMemo(() => {
    const map = new Map<string, number>();
    (cart?.items ?? []).forEach((item) => map.set(item.product_id, item.quantity));
    return map;
  }, [cart]);

  const handleAdd = async (product: Product) => {
    if (!user) {
      navigate(`/customer/auth?next=${encodeURIComponent('/customer')}`);
      return;
    }
    if (user.role !== 'customer') {
      toast.push({ title: 'Customers only', description: 'Sign in with a customer account to shop.', tone: 'error' });
      return;
    }
    setAddingId(product.id);
    try {
      const current = cartQuantities.get(product.id) ?? 0;
      await updateItem(product.id, current + 1);
      toast.push({ title: `Added ${product.name}`, description: `${formatINR(product.price)} · ${product.store_name}`, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not add item', description: errorMessage(error), tone: 'error' });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h1"
        title="Discover what’s nearby"
        subtitle="Live catalogue and stock from Dwarka stores — search, filter and add to your cart."
      />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="discover-search" className="mb-1 block text-xs font-semibold text-slate-700">
              Search products and stores
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                id="discover-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Amul Taaza, atta, salt, pharmacy…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          <SelectField
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            options={categoryOptions}
          />
          <SelectField
            label="Store"
            value={storeFilter}
            onChange={(event) => setStoreFilter(event.target.value)}
            options={[
              { value: '', label: 'All stores' },
              ...(storesResource.data?.stores ?? []).map((store) => ({ value: store.id, label: store.name })),
            ]}
          />
          {activeTab === 'products' && (
            <>
              <SelectField
                label="Sort by"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                options={[
                  { value: 'name', label: 'Name (A-Z)' },
                  { value: 'price_asc', label: 'Price (low to high)' },
                  { value: 'price_desc', label: 'Price (high to low)' },
                  { value: 'newest', label: 'Newly added' },
                ]}
              />
              <div className="text-xs">
                <label htmlFor="max-price" className="mb-1 block font-semibold text-slate-700">
                  Max price (₹)
                </label>
                <input
                  id="max-price"
                  type="number"
                  min={0}
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value)}
                  placeholder="Any"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(event) => setInStockOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  In stock only
                </label>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex gap-1 border-t border-slate-100 pt-3">
          {(
            [
              { id: 'products', label: 'Products' },
              { id: 'stores', label: 'Stores' },
            ] as { id: DiscoverTab; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              aria-pressed={activeTab === item.id}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                activeTab === item.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Card>

      {activeTab === 'products' ? (
        productsResource.loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-64" />
            ))}
          </div>
        ) : productsResource.error ? (
          <ErrorNote>{productsResource.error}</ErrorNote>
        ) : (productsResource.data?.products ?? []).length === 0 ? (
          <EmptyState
            icon={<PackageSearch className="h-8 w-8" aria-hidden="true" />}
            title="No products matched your search"
            description="Try a different keyword or clear the filters. New stores appear here as soon as sellers publish their catalogue."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchInput('');
                  setCategory('');
                  setStoreFilter('');
                  setMaxPrice('');
                  setInStockOnly(false);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(productsResource.data?.products ?? []).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                quantityInCart={cartQuantities.get(product.id) ?? 0}
                adding={addingId === product.id}
                onAdd={() => handleAdd(product)}
              />
            ))}
          </div>
        )
      ) : storesResource.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : (storesResource.data?.stores ?? []).length === 0 ? (
        <EmptyState
          icon={<StoreIcon className="h-8 w-8" aria-hidden="true" />}
          title="No nearby stores found"
          description="Try a different search term. Sellers who publish their store become discoverable here immediately."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(storesResource.data?.stores ?? []).map((store) => (
            <StoreCard key={store.id} store={store} />
          ))}
        </div>
      )}
    </div>
  );
};

export const ProductCard: React.FC<{
  product: Product;
  quantityInCart: number;
  adding?: boolean;
  onAdd: () => void;
  preview?: boolean;
}> = ({ product, quantityInCart, adding, onAdd, preview = false }) => {
  const outOfStock = product.availabilityState
    ? product.availabilityState === 'out_of_stock'
    : (product.stock ?? 0) <= 0;
  const { isSaved, toggle } = useSaved(!preview);
  const toast = useToast();
  const saved = isSaved(product.id);

  return (
    <Card className="relative flex flex-col overflow-hidden">
      {!preview && <button
        type="button"
        aria-label={saved ? `Remove ${product.name} from saved items` : `Save ${product.name}`}
        aria-pressed={saved}
        onClick={() =>
          toggle(product.id).catch((error) => toast.push({ title: errorMessage(error), tone: 'error' }))
        }
        className="absolute left-2 top-2 z-10 rounded-full bg-white/95 p-1.5 shadow-sm hover:bg-white"
      >
        <Heart className={`h-4 w-4 ${saved ? 'fill-red-500 text-red-500' : 'text-slate-500'}`} aria-hidden="true" />
      </button>}
      <Link to={`/products/${product.id}`} className="block">
        <div className="relative aspect-[4/3] bg-slate-100">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-300">
              <ShoppingBag className="h-8 w-8" aria-hidden="true" />
            </div>
          )}
          {outOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/55">
              <span className="rounded bg-red-600 px-2 py-1 text-[11px] font-bold text-white">Out of stock</span>
            </div>
          )}
          <span className="absolute bottom-2 right-2 max-w-[70%] truncate rounded bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
            {product.store_name}
          </span>
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{product.category}</span>
        <Link to={`/products/${product.id}`} className="mt-0.5 text-sm font-bold text-slate-900 hover:text-blue-700">
          {product.name}
        </Link>
        {(product.brand || product.unit) && (
          <p className="mt-0.5 text-[11px] text-slate-500">{[product.brand, product.unit].filter(Boolean).join(' · ')}</p>
        )}
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{product.description}</p>
        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-extrabold tabular-nums text-slate-900">
              {formatINR(product.price)}
              {product.mrp && product.mrp > product.price && (
                <span className="ml-1.5 text-[11px] font-medium text-slate-400 line-through">{formatINR(product.mrp)}</span>
              )}
            </span>
            <span
              className={`text-[11px] font-medium ${
                outOfStock ? 'text-red-600' : product.availabilityState === 'low' ? 'text-amber-600' : 'text-blue-700'
              }`}
            >
              {product.availabilityLabel ?? (outOfStock ? 'Unavailable' : `${product.stock} in stock`)}
            </span>
          </div>
          <Button
            className="mt-3 w-full"
            disabled={preview || outOfStock}
            loading={adding}
            onClick={onAdd}
            aria-label={`Add ${product.name} to cart`}
          >
            {preview ? 'Preview only' : quantityInCart > 0 ? `Add another (${quantityInCart} in cart)` : 'Add to cart'}
          </Button>
        </div>
      </div>
    </Card>
  );
};

export const StoreCard: React.FC<{ store: Store }> = ({ store }) => (
  <Card className="flex flex-col overflow-hidden">
    <Link to={`/stores/${store.id}`} className="block">
      <div className="aspect-[16/7] bg-slate-100">
        {store.image ? (
          <img src={store.image} alt={store.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300">
            <StoreIcon className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
      </div>
    </Link>
    <div className="flex flex-1 flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/stores/${store.id}`} className="text-sm font-bold text-slate-900 hover:text-blue-700">
          {store.name}
        </Link>
        <Badge tone={store.status === 'open' ? 'success' : 'neutral'}>
          {store.statusLabel ?? (store.status === 'open' ? 'Open now' : 'Closed')}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{store.description}</p>
      <dl className="mt-3 space-y-1 text-[11px] text-slate-600">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>
            {store.address}, {store.city}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>{store.opening_hours}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>
            {store.product_count ?? 0} products · {store.category}
            {store.distanceKm != null && ` · ${store.distanceKm} km away`}
          </span>
        </div>
      </dl>
    </div>
  </Card>
);

/* -------------------------------------------------------------------------- */
/* Store detail                                                               */
/* -------------------------------------------------------------------------- */

export const StoreDetailPage: React.FC<{ storeId: string; preview?: boolean }> = ({ storeId, preview = false }) => {
  const { user, config } = useAuth();
  const { cart, updateItem } = useCart();
  const toast = useToast();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [more, setMore] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const location = useBrowseLocation();
  const geo = locationParams(location);
  const resource = useApiResource(
    () =>
      api.get<{
        store: Store;
        products: Product[];
        total: number;
        hasMore: boolean;
        categories: { category: string; count: number }[];
      }>(
        `${preview ? '/api/seller/store/preview' : `/api/customer/stores/${storeId}`}?${new URLSearchParams({
          ...(categoryFilter ? { category: categoryFilter } : {}),
          ...geo,
        }).toString()}`
      ),
    [storeId, preview, categoryFilter, geo.lat, geo.lng]
  );

  useEffect(() => {
    setMore([]);
    setPage(1);
  }, [storeId, categoryFilter]);

  const cartQuantities = useMemo(() => {
    const map = new Map<string, number>();
    (cart?.items ?? []).forEach((item) => map.set(item.product_id, item.quantity));
    return map;
  }, [cart]);

  if (resource.loading) return <Spinner label="Loading store…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const { store } = resource.data;
  const total = resource.data.total ?? resource.data.products.length;
  const categories = resource.data.categories ?? [];
  const products = [...resource.data.products, ...more];
  const hasMore = products.length < total;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await api.get<{ products: Product[] }>(
        `${preview ? '/api/seller/store/preview' : `/api/customer/stores/${storeId}`}?${new URLSearchParams({
          page: String(page + 1),
          ...(categoryFilter ? { category: categoryFilter } : {}),
        }).toString()}`
      );
      setMore((current) => [...current, ...next.products]);
      setPage((value) => value + 1);
    } catch (error) {
      toast.push({ title: 'Could not load more', description: errorMessage(error), tone: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  const add = async (product: Product) => {
    if (preview) return;
    if (!user) {
      navigate(`/customer/auth?next=${encodeURIComponent(`/stores/${storeId}`)}`);
      return;
    }
    setAddingId(product.id);
    try {
      await updateItem(product.id, (cartQuantities.get(product.id) ?? 0) + 1);
      toast.push({ title: `Added ${product.name}`, tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not add item', description: errorMessage(error), tone: 'error' });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {!preview && <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/customer" className="hover:text-slate-800">
          Discover
        </Link>
        <span className="mx-1.5">/</span>
        <Link to="/discover/stores" className="hover:text-slate-800">
          Stores
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">{store.name}</span>
      </nav>}

      <Card className="overflow-hidden">
        <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
          <div className="aspect-[16/10] bg-slate-100 sm:aspect-auto">
            {store.image ? (
              <img src={store.image} alt={store.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-300">
                <StoreIcon className="h-10 w-10" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{store.name}</h1>
              <Badge tone={store.status === 'open' ? 'success' : 'neutral'}>
                {store.statusLabel ?? (store.status === 'open' ? 'Open now' : 'Closed')}
              </Badge>
              <Badge tone="info">{store.category}</Badge>
              {store.distanceKm != null && <Badge tone="neutral">{store.distanceKm} km away</Badge>}
            </div>
            {store.status !== 'open' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
                {store.status_message || 'This store is not taking new orders right now.'} You can still browse, but
                checkout is unavailable until it reopens.
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-600">{store.description}</p>
            <dl className="mt-3 grid gap-1.5 text-xs text-slate-600 sm:grid-cols-2">
              <div className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>
                  {store.address}, {store.city} {store.pincode}
                </span>
              </div>
              <div className="flex items-start gap-1.5">
                <Clock className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>{store.opening_hours}</span>
              </div>
            </dl>
            {store.fulfilmentMinutes && (
              <p className="mt-2 text-xs text-slate-600">
                Usually ready in {store.fulfilmentMinutes.min}–{store.fulfilmentMinutes.max} min
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {store.supports_delivery ? (
                <Badge tone="success">Home delivery · {formatINR(config?.deliveryFeePerStore ?? 30)} per order</Badge>
              ) : (
                <Badge tone="neutral">Pickup only</Badge>
              )}
              {store.supports_pickup && <Badge tone="info">Store pickup available</Badge>}
            </div>
            {store.contact_phone && <p className="mt-3 text-xs text-slate-500">Store contact: {store.contact_phone}</p>}
          </div>
        </div>
      </Card>

      <SectionHeader title={`Products (${total})`} subtitle="Stock updates live as the store sells and restocks." />
      {categories.length > 1 && (
        <div className="-mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
          {[{ category: '', count: total }, ...categories].map((row) => (
            <button
              key={row.category || 'all'}
              type="button"
              aria-pressed={categoryFilter === row.category}
              onClick={() => setCategoryFilter(row.category)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                categoryFilter === row.category
                  ? 'border-blue-600 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {row.category || 'All'} ({row.count})
            </button>
          ))}
        </div>
      )}
      {products.length === 0 ? (
        <EmptyState title="This store has not published products yet" description="Check back shortly." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              quantityInCart={cartQuantities.get(product.id) ?? 0}
              adding={addingId === product.id}
              onAdd={() => add(product)}
              preview={preview}
            />
          ))}
        </div>
      )}
      {hasMore && (
        <div className="text-center">
          <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
            Load more products
          </Button>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Product detail + stock check / reservation                                 */
/* -------------------------------------------------------------------------- */

export const ProductDetailPage: React.FC<{ productId: string }> = ({ productId }) => {
  const { user } = useAuth();
  const { cart, updateItem } = useCart();
  const toast = useToast();
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'stock' | 'reserve' | null>(null);
  const [requestQty, setRequestQty] = useState(1);
  const [note, setNote] = useState('');

  const resource = useApiResource(
    () =>
      api.get<{ product: Product; latestStockRequest?: { status: string; requested_quantity: number } | null }>(
        `/api/customer/products/${productId}`
      ),
    [productId]
  );
  const { isSaved, toggle } = useSaved();

  if (resource.loading) return <Spinner label="Loading product…" />;
  if (resource.error) return <ErrorNote>{resource.error}</ErrorNote>;
  if (!resource.data) return null;

  const product = resource.data.product;
  const outOfStock = product.availabilityState
    ? product.availabilityState === 'out_of_stock'
    : (product.stock ?? 0) <= 0;
  const storeClosed = product.store_status !== undefined && product.store_status !== 'open';
  const inCart = (cart?.items ?? []).find((item) => item.product_id === product.id)?.quantity ?? 0;

  const requireCustomer = () => {
    if (!user) {
      navigate(`/customer/auth?next=${encodeURIComponent(`/products/${productId}`)}`);
      return false;
    }
    if (user.role !== 'customer') {
      toast.push({ title: 'Customer account required', description: 'Sign in as a customer to shop.', tone: 'error' });
      return false;
    }
    return true;
  };

  const addToCart = async () => {
    if (!requireCustomer()) return;
    setBusy(true);
    try {
      await updateItem(product.id, inCart + quantity);
      toast.push({ title: `${quantity} × ${product.name} added`, description: formatINR(product.price * quantity), tone: 'success' });
    } catch (error) {
      toast.push({ title: 'Could not add to cart', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = async () => {
    if (!requireCustomer()) return;
    setBusy(true);
    try {
      const path = modal === 'stock' ? '/api/customer/stock-requests' : '/api/customer/reservations';
      const result = await api.post<{ message: string }>(path, {
        productId: product.id,
        requestedQuantity: requestQty,
        note: note || undefined,
      });
      toast.push({ title: modal === 'stock' ? 'Stock check sent' : 'Reservation requested', description: result.message, tone: 'success' });
      setModal(null);
      setNote('');
    } catch (error) {
      toast.push({ title: 'Request failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/customer" className="hover:text-slate-800">
          Discover
        </Link>
        <span className="mx-1.5">/</span>
        <Link to={`/stores/${product.store_id}`} className="hover:text-slate-800">
          {product.store_name}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">{product.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card className="overflow-hidden">
          <div className="aspect-[4/3] bg-slate-100">
            {product.image ? (
              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-300">
                <ShoppingBag className="h-10 w-10" aria-hidden="true" />
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <Badge tone="info">{product.category}</Badge>
            <div className="mt-2 flex items-start justify-between gap-2">
              <h1 className="text-xl font-bold text-slate-900">{product.name}</h1>
              <button
                type="button"
                aria-pressed={isSaved(product.id)}
                aria-label={isSaved(product.id) ? 'Remove from saved items' : 'Save for later'}
                onClick={() =>
                  toggle(product.id).catch((error) => toast.push({ title: errorMessage(error), tone: 'error' }))
                }
                className="rounded-full border border-slate-200 p-2 hover:bg-slate-50"
              >
                <Heart
                  className={`h-4 w-4 ${isSaved(product.id) ? 'fill-red-500 text-red-500' : 'text-slate-500'}`}
                  aria-hidden="true"
                />
              </button>
            </div>
            {(product.brand || product.unit) && (
              <p className="mt-0.5 text-xs text-slate-500">{[product.brand, product.unit].filter(Boolean).join(' · ')}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Sold by{' '}
              <Link to={`/stores/${product.store_id}`} className="font-semibold text-blue-700 hover:underline">
                {product.store_name}
              </Link>{' '}
              · {product.store_city}
            </p>
            <p className="mt-3 text-2xl font-extrabold tabular-nums text-slate-900">
              {formatINR(product.price)}
              {product.mrp && product.mrp > product.price && (
                <span className="ml-2 text-sm font-medium text-slate-400 line-through">{formatINR(product.mrp)}</span>
              )}
            </p>
            <p
              className={`mt-1 text-xs font-semibold ${
                outOfStock ? 'text-red-600' : product.availabilityState === 'low' ? 'text-amber-600' : 'text-blue-700'
              }`}
            >
              {outOfStock
                ? 'Out of stock right now'
                : `${product.availabilityLabel ?? 'In stock'} · ${product.stock} unit(s) available`}
            </p>
            {storeClosed && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
                {product.store_name} is closed right now. You can save this item and order when it reopens.
              </p>
            )}
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{product.description}</p>
            {product.product_info && <p className="mt-2 text-xs leading-relaxed text-slate-500">{product.product_info}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <QuantityStepper
                value={quantity}
                min={1}
                max={Math.max(1, Math.min(product.stock ?? 1, 20))}
                onChange={setQuantity}
                label={`quantity for ${product.name}`}
                disabled={outOfStock}
              />
              <Button onClick={addToCart} disabled={outOfStock || storeClosed} loading={busy}>
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {inCart > 0 ? `Update cart (${inCart} in cart)` : 'Add to cart'}
              </Button>
            </div>
            {inCart > 0 && (
              <p className="mt-2 text-[11px] text-emerald-700">
                {inCart} unit(s) already in your cart from {product.store_name}.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900">Ask the store</h2>
            <p className="mt-1 text-xs text-slate-500">
              Not sure about stock, or want it kept aside? Send a request the store can answer.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setModal('stock'); setRequestQty(1); }}>
                Request stock check
              </Button>
              <Button variant="secondary" onClick={() => { setModal('reserve'); setRequestQty(1); }}>
                Request reservation
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <InfoNote>
                A confirmed <strong>stock check</strong> only tells you the item is available — it does not hold stock.
              </InfoNote>
              <InfoNote>
                A confirmed <strong>reservation</strong> genuinely holds units in the store’s inventory, and releases them
                automatically when the hold expires.
              </InfoNote>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'stock' ? 'Request a stock check' : 'Request a reservation'}
        description={`Send a real request to ${product.store_name}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={submitRequest} loading={busy}>
              Send request
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {product.image && <img src={product.image} alt="" className="h-12 w-12 rounded object-cover" />}
          <div>
            <p className="text-sm font-semibold text-slate-900">{product.name}</p>
            <p className="text-xs text-slate-500">
              {formatINR(product.price)} · {product.store_name}
            </p>
          </div>
        </div>
        <div className="text-xs">
          <span className="mb-1 block font-semibold text-slate-700">How many units do you need?</span>
          <QuantityStepper
            value={requestQty}
            min={1}
            max={50}
            onChange={setRequestQty}
            label="requested quantity"
          />
        </div>
        <TextAreaField
          label="Note to the store (optional)"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Need it by 7pm today"
        />
      </Modal>
    </div>
  );
};

export const NotFoundPage: React.FC = () => (
  <EmptyState
    icon={<PackageSearch className="h-8 w-8" aria-hidden="true" />}
    title="Page not found"
    description="The page you were looking for does not exist or has moved."
    action={<Button onClick={() => navigate('/customer')}>Back to home</Button>}
  />
);
