import Image from "next/image";

export function SeedIcon({
  height = 24,
  alt = "",
  className = "",
}: {
  height?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <Image
      src="/icons/sunflower-seed.svg"
      width={Math.round((height * 24) / 34)}
      height={height}
      alt={alt}
      className={`seed-icon ${className}`.trim()}
    />
  );
}
