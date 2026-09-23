const VAHANSYNC_COMPANION_MARK_URL = "https://yieicrulmncikbjxjupv.supabase.co/storage/v1/object/public/vahansync-brand/v2/vahansync-v-check-road-mark.png";

type BrandMarkProps = {
  className?: string;
  decorative?: boolean;
};

export function BrandMark({ className = "", decorative = false }: BrandMarkProps) {
  return (
    <span
      className={`vahan-brand-mark ${className}`.trim()}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "VahanSync readiness and route mark" })}
    >
      <img
        src={VAHANSYNC_COMPANION_MARK_URL}
        alt=""
        decoding="async"
      />
    </span>
  );
}

export { VAHANSYNC_COMPANION_MARK_URL };
