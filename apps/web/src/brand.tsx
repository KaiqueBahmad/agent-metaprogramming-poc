export function Brand({ link = false }: { link?: boolean }) {
  const name = (
    <>
      <span className="brand-name">Agentic</span>
      <span className="brand-product">ERP</span>
    </>
  );

  return link ? (
    <a href="/" className="brand" aria-label="Agentic ERP — início">
      {name}
    </a>
  ) : (
    <div className="brand" aria-label="Agentic ERP">
      {name}
    </div>
  );
}
