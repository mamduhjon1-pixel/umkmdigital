export function Skeleton({ className = "", style = {} }) {
  return <span className={`skeleton ${className}`.trim()} style={{ display: "block", ...style }} aria-hidden="true" />;
}

export function ProductCardSkeleton() {
  return (
    <article className="product-card skeleton-card">
      <Skeleton className="skeleton-product-img" />
      <div className="product-info">
        <Skeleton style={{ height: 12, width: "92%", marginBottom: 8 }} />
        <Skeleton style={{ height: 12, width: "70%", marginBottom: 10 }} />
        <Skeleton style={{ height: 16, width: "45%" }} />
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 8 }) {
  return (
    <div className="grid-5 product-grid-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
