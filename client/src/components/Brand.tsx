type BrandProps = {
  compact?: boolean;
};

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className="brand">
      <img
        src="/branding/networknerd1337.jpg"
        alt="NetworkNerd1337"
        width={compact ? 34 : 44}
        height={compact ? 34 : 44}
      />
      <div className="brand-text">
        <strong>NerdGram1337</strong>
        <span>by NetworkNerd1337</span>
      </div>
    </div>
  );
}
