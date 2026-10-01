import Image from "next/image";
import sunflower from "@/public/icons/sunflower.png";

export function SunflowerIcon({
  size = 40,
  alt = "",
  className,
}: {
  size?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <Image
      src={sunflower}
      sizes={`${size}px`}
      loading="eager"
      alt={alt}
      className={className}
      style={{ maxWidth: size, height: "auto", objectFit: "contain" }}
    />
  );
}
